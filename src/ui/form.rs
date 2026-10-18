//! Declarative forms, shared by plugin settings and by `ui.form`.
//!
//! A plugin cannot draw. It can name the fields it needs and the host draws
//! them, which is the only arrangement in which "plugins can be interactive"
//! and "the interface stays coherent" are both true — every plugin's settings
//! page is made of the same controls, laid out the same way, in the app's own
//! colours.
//!
//! The schema is the same object in both places, so a plugin author writes it
//! once:
//!
//! ```json
//! {
//!   "fields": [
//!     { "key": "token", "label": "API Token", "type": "password" },
//!     { "key": "site",  "label": "Site", "type": "select",
//!       "options": [{ "value": "a", "label": "A" }] },
//!     { "key": "wide",  "label": "Wide images", "type": "checkbox" }
//!   ],
//!   "ok": "保存"
//! }
//! ```
//!
//! `type` is one of `text` (the default), `password`, `number`, `textarea`,
//! `checkbox` or `select`. Anything unrecognised is drawn as text rather than
//! rejected: a plugin written against a later version should still work here,
//! and a text box is a usable answer to most questions.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::{ActiveTheme, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use serde_json::{Map, Value};

/// One control the plugin asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Field {
    /// The key this field's value is returned under.
    pub key: String,
    pub label: String,
    pub kind: Kind,
    pub placeholder: Option<String>,
    /// A sentence under the field. Plugin settings are usually a token and a
    /// URL with no explanation, and a hint is the only place an author can say
    /// where to get one.
    pub help: Option<String>,
    /// What the field starts as.
    pub default: Value,
}

/// The controls a schema can ask for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Kind {
    Text,
    Password,
    Number,
    Textarea,
    Checkbox,
    Select(Vec<Option_>),
}

/// One choice in a [`Kind::Select`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Option_ {
    pub value: String,
    pub label: String,
}

/// Read a schema into the fields it names.
///
/// Missing `fields` means the plugin declared settings it does not describe,
/// which is a bug in the plugin rather than a reason to fail: the caller gets
/// no fields and the plugin gets no settings, and it will find out.
pub fn parse(schema: &Value) -> Vec<Field> {
    schema
        .get("fields")
        .and_then(Value::as_array)
        .map(|fields| fields.iter().filter_map(parse_field).collect())
        .unwrap_or_default()
}

fn parse_field(field: &Value) -> Option<Field> {
    let key = field.get("key")?.as_str()?.to_owned();
    let label = field
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or(&key)
        .to_owned();

    let kind = match field.get("type").and_then(Value::as_str) {
        Some("password") => Kind::Password,
        Some("number") => Kind::Number,
        Some("textarea") => Kind::Textarea,
        Some("checkbox") => Kind::Checkbox,
        Some("select") => Kind::Select(
            field
                .get("options")
                .and_then(Value::as_array)
                .map(|options| {
                    options
                        .iter()
                        .filter_map(|option| {
                            // A bare string is a perfectly good option; the
                            // value and the label are the same thing.
                            if let Some(text) = option.as_str() {
                                return Some(Option_ {
                                    value: text.to_owned(),
                                    label: text.to_owned(),
                                });
                            }

                            Some(Option_ {
                                value: option.get("value")?.as_str()?.to_owned(),
                                label: option
                                    .get("label")
                                    .and_then(Value::as_str)
                                    .or_else(|| option.get("value").and_then(Value::as_str))?
                                    .to_owned(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default(),
        ),
        _ => Kind::Text,
    };

    Some(Field {
        key,
        label,
        kind,
        placeholder: field
            .get("placeholder")
            .and_then(Value::as_str)
            .map(str::to_owned),
        help: field.get("help").and_then(Value::as_str).map(str::to_owned),
        default: field.get("default").cloned().unwrap_or(Value::Null),
    })
}

/// The label on the button that accepts the form.
pub fn ok_label(schema: &Value) -> String {
    schema
        .get("ok")
        .and_then(Value::as_str)
        .unwrap_or("确定")
        .to_owned()
}

/// A form the user is filling in.
///
/// Holds the entities the text fields are drawn with, because a text input in
/// GPUI is an entity rather than a value: its editing state — selection, caret,
/// undo history — lives there, and rebuilding it each frame would lose all of
/// that between keystrokes.
pub struct Form {
    fields: Vec<Field>,
    inputs: HashMap<String, Entity<InputState>>,
    /// Everything the user has chosen, for the controls that are not text.
    choices: Rc<RefCell<HashMap<String, Value>>>,
}

impl Form {
    /// Build the controls for `schema`.
    ///
    /// Needs a window because [`InputState`] does. Every field is created up
    /// front rather than on first draw so that the dialog's builder — which may
    /// run more than once — never allocates an entity.
    pub fn new(schema: &Value, values: &Value, window: &mut Window, cx: &mut App) -> Self {
        let fields = parse(schema);
        let mut inputs = HashMap::new();
        let mut choices = HashMap::new();

        for field in &fields {
            let current = values
                .get(&field.key)
                .cloned()
                .unwrap_or_else(|| field.default.clone());

            match field.kind {
                Kind::Text | Kind::Password | Kind::Number | Kind::Textarea => {
                    let placeholder = field.placeholder.clone().unwrap_or_default();
                    let text = scalar_text(&current);
                    let masked = matches!(field.kind, Kind::Password);

                    let state = cx.new(|cx| {
                        let mut state = InputState::new(window, cx)
                            .placeholder(placeholder)
                            .default_value(text);

                        // A password field starts hidden and stays hidden:
                        // `Input`'s mask toggle is for the user to reveal a
                        // typo, and a token is not a typo.
                        if masked {
                            state.toggle_masked(window, cx);
                        }

                        state
                    });

                    inputs.insert(field.key.clone(), state);
                }
                Kind::Checkbox => {
                    choices.insert(
                        field.key.clone(),
                        Value::Bool(current.as_bool().unwrap_or(false)),
                    );
                }
                Kind::Select(_) => {
                    let value = if current.is_null() {
                        field.default.clone()
                    } else {
                        current
                    };
                    choices.insert(field.key.clone(), value);
                }
            }
        }

        Self {
            fields,
            inputs,
            choices: Rc::new(RefCell::new(choices)),
        }
    }

    /// Whether there is anything to draw.
    pub fn is_empty(&self) -> bool {
        self.fields.is_empty()
    }

    /// Whether any field is a text field, so a dialog knows whether to focus one.
    pub fn has_inputs(&self) -> bool {
        !self.inputs.is_empty()
    }

    /// The first text field, for focusing when the dialog opens.
    pub fn first_input(&self) -> Option<&Entity<InputState>> {
        self.fields
            .iter()
            .find_map(|field| self.inputs.get(&field.key))
    }

    /// Draw the form.
    pub fn render(&self, cx: &App) -> AnyElement {
        v_flex()
            .w_full()
            .gap_3()
            .children(self.fields.iter().map(|field| self.field(field, cx)))
            .into_any_element()
    }

    fn field(&self, field: &Field, cx: &App) -> AnyElement {
        let control: AnyElement = match &field.kind {
            Kind::Text | Kind::Password | Kind::Number | Kind::Textarea => {
                match self.inputs.get(&field.key) {
                    Some(state) => Input::new(state).bordered(true).into_any_element(),
                    None => div().into_any_element(),
                }
            }
            Kind::Checkbox => {
                let choices = self.choices.clone();
                let key = field.key.clone();
                let checked = choices
                    .borrow()
                    .get(&key)
                    .and_then(Value::as_bool)
                    .unwrap_or(false);

                Checkbox::new(format!("field:{}", field.key))
                    .checked(checked)
                    .label(field.label.clone())
                    .on_change(move |checked, _, _| {
                        choices
                            .borrow_mut()
                            .insert(key.clone(), Value::Bool(*checked));
                    })
                    .into_any_element()
            }
            Kind::Select(options) => {
                let choices = self.choices.clone();
                let key = field.key.clone();
                let selected = choices
                    .borrow()
                    .get(&key)
                    .and_then(Value::as_str)
                    .map(str::to_owned);

                // Segmented buttons rather than a dropdown. A plugin's options
                // are two or three short words — "list", "grid", "auto" — and a
                // popup to choose between them is a click more for nothing.
                h_flex()
                    .gap_1()
                    .flex_wrap()
                    .children(options.iter().map(|option| {
                        let choices = choices.clone();
                        let key = key.clone();
                        let value = option.value.clone();
                        let active = selected.as_deref() == Some(option.value.as_str());

                        let mut button =
                            Button::new(format!("option:{}:{}", field.key, option.value))
                                .xsmall()
                                .label(option.label.clone());

                        button = if active {
                            button.primary()
                        } else {
                            button.ghost()
                        };

                        button
                            .on_click(move |_, _, _| {
                                choices
                                    .borrow_mut()
                                    .insert(key.clone(), Value::String(value.clone()));
                            })
                            .into_any_element()
                    }))
                    .into_any_element()
            }
        };

        // A checkbox carries its own label, so drawing the form's label above it
        // would print the same words twice.
        let labelled = !matches!(field.kind, Kind::Checkbox);

        v_flex()
            .w_full()
            .gap_1()
            .when(labelled, |this| {
                this.child(
                    div()
                        .text_xs()
                        .text_color(cx.theme().foreground)
                        .child(field.label.clone()),
                )
            })
            .child(control)
            .when_some(field.help.clone(), |this, help| {
                this.child(
                    div()
                        .text_xs()
                        .text_color(cx.theme().muted_foreground)
                        .child(help),
                )
            })
            .into_any_element()
    }

    /// Everything the user has entered, as the object to hand back.
    ///
    /// Unknown keys are dropped rather than passed through: the plugin gets
    /// back exactly the shape its own schema described.
    pub fn value(&self, cx: &App) -> Value {
        let mut out = Map::new();

        for field in &self.fields {
            let value = match &field.kind {
                Kind::Text | Kind::Password | Kind::Number | Kind::Textarea => {
                    match self.inputs.get(&field.key) {
                        Some(state) => {
                            let text = state.read(cx).value().to_string();

                            match field.kind {
                                // An empty number is "not given", not zero.
                                Kind::Number if text.trim().is_empty() => Value::Null,
                                Kind::Number => text
                                    .trim()
                                    .parse::<f64>()
                                    .map(|number| serde_json::json!(number))
                                    .unwrap_or(Value::String(text)),
                                _ => Value::String(text),
                            }
                        }
                        None => Value::Null,
                    }
                }
                Kind::Checkbox | Kind::Select(_) => self
                    .choices
                    .borrow()
                    .get(&field.key)
                    .cloned()
                    .unwrap_or(Value::Null),
            };

            out.insert(field.key.clone(), value);
        }

        Value::Object(out)
    }
}

/// A stored value as the text a field starts with.
///
/// Settings are opaque JSON, so a value can be anything the plugin wrote. A
/// string is itself; anything else is shown in its JSON form, which at least
/// round-trips rather than being silently blanked.
fn scalar_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        other => other.to_string(),
    }
}
