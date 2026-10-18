//! The dialogs a plugin is allowed to raise.
//!
//! This is the whole of a plugin's interface vocabulary: alert, confirm,
//! prompt, notify, form, pick. A plugin cannot draw — it can only ask for one
//! of these — which is what keeps every plugin's login page and settings page
//! looking like Rome instead of like themselves, and is the only arrangement in
//! which "plugins can be interactive" and "the interface stays coherent" are
//! both true.
//!
//! Every one of these except a notification blocks the plugin: it is sitting
//! inside its own `await` while the user decides. That is safe here in a way it
//! would not be on the UI thread — the plugin and the worker are both on the
//! worker thread, and the window is free.
//!
//! Everything here opens through [`WindowExt::open_alert_dialog`], and nothing
//! here may use `open_dialog`. A plain `Dialog` renders a footer only when the
//! caller sets one, and `button_props` on it installs the callbacks behind the
//! Confirm and Cancel actions without drawing anything to press: every dialog
//! built that way comes up with no buttons at all. `AlertDialog` is the one
//! that turns `button_props` into a footer. Where the footer that produces is
//! the wrong one — a dialog with nothing to confirm — set `footer` explicitly
//! rather than dropping back to `open_dialog`.
//!
//! `title` and `button_props` have to come before `content` on that type. Both
//! assert that no content builder has been set, on the grounds that an
//! `AlertDialog` built from a trigger has no content of its own to define — and
//! the assertion fires here too, where there is no trigger and the content
//! builder is the one being set afterwards. The order below is load-bearing,
//! and in a release build it is not: `debug_assert` compiles out, so getting it
//! wrong would show up only as a panic in a debug build.

use std::rc::Rc;

use gpui_kit::component::button::Button;
use gpui_kit::component::dialog::{DialogButtonProps, DialogContent, DialogFooter};
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::list::ListItem;
use gpui_kit::component::{ActiveTheme, WindowExt, v_flex};
use gpui_kit::*;
use serde_json::{Value, json};

use crate::plugin::DialogRequest;
use crate::worker::{Ask, Worker};

use super::form::{self, Form};

/// Show `ask` and answer the worker when the user is done.
///
/// Every path answers, including closing the dialog with the X or Escape: a
/// question that is dismissed without an answer is a "no", and the plugin must
/// not hang waiting for one that will never come.
pub fn open(ask: Ask, worker: Worker, window: &mut Window, cx: &mut App) {
    let Ask { id, request } = ask;

    match request {
        DialogRequest::Alert { message } => {
            let answer = worker.clone();
            let content_message = message.clone();
            window.open_alert_dialog(cx, move |dialog, _, _| {
                let shown = content_message.clone();
                dialog
                    .title("提示")
                    .button_props(
                        DialogButtonProps::default()
                            .ok_text("知道了")
                            .show_cancel(false),
                    )
                    .content(move |content, _, cx| content.child(body(&shown, cx)))
                    .on_ok({
                        let answer = answer.clone();
                        move |_, _, _| {
                            answer.answer(id, Value::Null);
                            true
                        }
                    })
                    .on_close({
                        let answer = answer.clone();
                        move |_, _, _| answer.answer(id, Value::Null)
                    })
            });
        }

        DialogRequest::Confirm { message } => {
            let ok = worker.clone();
            let cancel = worker.clone();
            let closed = worker.clone();
            let content_message = message.clone();
            window.open_alert_dialog(cx, move |dialog, _, _| {
                let shown = content_message.clone();
                dialog
                    .title("确认")
                    .button_props(
                        DialogButtonProps::default()
                            .ok_text("是")
                            .cancel_text("否")
                            .show_cancel(true),
                    )
                    .content(move |content, _, cx| content.child(body(&shown, cx)))
                    .on_ok({
                        let ok = ok.clone();
                        move |_, _, _| {
                            ok.answer(id, Value::Bool(true));
                            true
                        }
                    })
                    .on_cancel({
                        let cancel = cancel.clone();
                        move |_, _, _| {
                            cancel.answer(id, Value::Bool(false));
                            true
                        }
                    })
                    // Reached by Escape, the X, or a click on the backdrop.
                    .on_close({
                        let closed = closed.clone();
                        move |_, _, _| closed.answer(id, Value::Bool(false))
                    })
            });
        }

        DialogRequest::Prompt {
            message,
            title,
            placeholder,
            secret,
        } => {
            let input = cx.new(|cx| {
                let mut state = InputState::new(window, cx)
                    .placeholder(placeholder.clone().unwrap_or_default());
                if secret {
                    state.toggle_masked(window, cx);
                }
                state
            });

            let focus = input.read(cx).focus_handle(cx);
            window.defer(cx, move |window, cx| focus.focus(window, cx));

            let ok = worker.clone();
            let ok_input = input.clone();
            let cancel = worker.clone();
            let closed = worker.clone();
            let content_message = message.clone();

            window.open_alert_dialog(cx, move |dialog, _, _| {
                // Built inside the builder rather than before it: the content
                // builder is `Fn` and runs again whenever the dialog layer is
                // rebuilt, so anything it consumes has to be made fresh.
                let content_input = input.clone();
                let shown = content_message.clone();

                dialog
                    .title(title.clone().unwrap_or_else(|| "输入".to_owned()))
                    .button_props(
                        DialogButtonProps::default()
                            .ok_text("确定")
                            .cancel_text("取消")
                            .show_cancel(true),
                    )
                    .content(move |content, _, cx| {
                        content.child(body(&shown, cx)).child(
                            div()
                                .mt_2()
                                .w_full()
                                .child(Input::new(&content_input).bordered(true)),
                        )
                    })
                    .on_ok({
                        let ok = ok.clone();
                        let input = ok_input.clone();
                        move |_, _, cx| {
                            ok.answer(id, Value::String(input.read(cx).value().to_string()));
                            true
                        }
                    })
                    .on_cancel({
                        let cancel = cancel.clone();
                        move |_, _, _| {
                            cancel.answer(id, Value::Null);
                            true
                        }
                    })
                    .on_close({
                        let closed = closed.clone();
                        move |_, _, _| closed.answer(id, Value::Null)
                    })
            });
        }

        DialogRequest::Form { schema } => {
            let current = schema.get("defaults").cloned().unwrap_or(Value::Null);
            let form = Rc::new(Form::new(&schema, &current, window, cx));

            if form.is_empty() {
                // A schema with no fields asks nothing. Answering at once is
                // better than drawing an empty card the user has to dismiss.
                worker.answer(id, Value::Null);
                return;
            }

            if let Some(input) = form.first_input() {
                let focus = input.read(cx).focus_handle(cx);
                window.defer(cx, move |window, cx| focus.focus(window, cx));
            }

            let ok = worker.clone();
            let cancel = worker.clone();
            let closed = worker.clone();
            let ok_text = form::ok_label(&schema);

            window.open_alert_dialog(cx, move |dialog, _, _| {
                let content_form = form.clone();
                let content = move |content: DialogContent, _: &mut Window, cx: &mut App| {
                    content.child(content_form.render(cx))
                };

                let ok_form = form.clone();

                dialog
                    .w(px(460.))
                    .title("填写")
                    .button_props(
                        DialogButtonProps::default()
                            .ok_text(ok_text.clone())
                            .cancel_text("取消")
                            .show_cancel(true),
                    )
                    .content(content)
                    .on_ok({
                        let ok = ok.clone();
                        move |_, _, cx| {
                            ok.answer(id, ok_form.value(cx));
                            true
                        }
                    })
                    .on_cancel({
                        let cancel = cancel.clone();
                        move |_, _, _| {
                            cancel.answer(id, Value::Null);
                            true
                        }
                    })
                    .on_close({
                        let closed = closed.clone();
                        move |_, _, _| closed.answer(id, Value::Null)
                    })
            });
        }

        DialogRequest::Pick { items } => {
            // The host does not understand the items and has no business
            // trying: they go back exactly as they came.
            let cancel = worker.clone();

            window.open_alert_dialog(cx, move |dialog, _, _| {
                // Built inside the builder rather than before it: the content
                // builder is `Fn` and runs again whenever the dialog layer is
                // rebuilt, so anything it consumes has to be made fresh.
                let content_items = items.clone();
                let content_worker = worker.clone();

                dialog
                    .w(px(400.))
                    .title("选择")
                    .content(move |content, _, cx| {
                        // Read once, outside the map: every row takes it, and a
                        // row that fills the dialog's width needs the same
                        // corner as every other control in the window.
                        let radius = cx.theme().radius;

                        content.child(v_flex().w_full().children(
                            content_items.iter().enumerate().map(|(index, item)| {
                                let value = item.clone();
                                let label = label_of(item);
                                let answer = content_worker.clone();

                                // A row rather than a `Button`. A button's
                                // content box is centred and full width, so at
                                // this dialog's width a full-width button puts
                                // every label on its own axis and the choices
                                // have no left edge to read down; a hugging
                                // one puts the whole hit target in the first
                                // few centimetres of an empty row. Neither is
                                // what a list of choices is. `ListItem` is the
                                // library's own row — full width, label at the
                                // start, hover across the whole of it — and
                                // `Role::Button` is what keeps it announced as
                                // something to press rather than as text.
                                //
                                // Its own `px_3` is dropped so the labels line
                                // up with the title above them: a list of
                                // choices is body content, and the shared edge
                                // is what lets the eye run down it.
                                ListItem::new(format!("pick:{index}"))
                                    .role(Role::Button)
                                    .rounded(radius)
                                    .px_0()
                                    .on_click(move |_, window, cx| {
                                        answer.answer(id, value.clone());
                                        window.close_dialog(cx);
                                    })
                                    .child(label)
                            }),
                        ))
                    })
                    // A footer of its own rather than the one the alert dialog
                    // would build from `button_props`. That footer always ends
                    // in a confirm button, and there is nothing here to
                    // confirm: the list of items *is* the answer, and the only
                    // other thing the user can mean is "not this".
                    //
                    // The button answers the worker itself instead of going
                    // through `on_close`. Dismissing by Escape, the X or the
                    // backdrop runs that handler; `close_dialog` does not, so a
                    // button relying on it would leave the plugin waiting for
                    // an answer that never came.
                    .footer(DialogFooter::new().child(
                        Button::new("pick-cancel").label("取消").on_click({
                            let cancel = cancel.clone();
                            move |_, window, cx| {
                                cancel.answer(id, Value::Null);
                                window.close_dialog(cx);
                            }
                        }),
                    ))
                    // Dismissed without choosing. The plugin gets "nothing was
                    // picked", which it already has to handle for the case
                    // where the user picks nothing.
                    .on_close({
                        let cancel = cancel.clone();
                        move |_, _, _| cancel.answer(id, Value::Null)
                    })
            });
        }

        // These three are not questions and never reach this function — the
        // worker answers them itself, sending an event or opening the link.
        // Answering here as well is harmless and keeps the match total, which
        // matters more than the two lines it costs: the alternative is a `_`
        // arm that would silently swallow a question added later.
        DialogRequest::Notify { .. }
        | DialogRequest::Progress { .. }
        | DialogRequest::OpenExternal { .. } => worker.answer(id, Value::Null),

        DialogRequest::Login { url } => {
            let answer = worker.clone();

            // The cookies go back with the answer rather than through a
            // separate command: the worker is blocked waiting for this reply,
            // and the plugin's next request — the one that needs to be
            // authenticated — cannot be answered before it is. Sending them
            // here means they are written before the plugin continues.
            let opened = crate::login::open(url, cx, move |finished, cookies| {
                let cookies: Vec<Value> = cookies
                    .iter()
                    .map(|cookie| {
                        json!({
                            "domain": cookie.domain,
                            "path": cookie.path,
                            "name": cookie.name,
                            "value": cookie.value,
                            "host_only": cookie.host_only,
                            "expires_at": cookie.expires_at,
                            "secure": cookie.secure,
                            "http_only": cookie.http_only,
                        })
                    })
                    .collect();

                answer.answer(id, json!({ "finished": finished, "cookies": cookies }));
            });

            if let Err(error) = opened {
                // There is no window to put the message in, so the plugin is
                // told "no" and the app says why. A plugin that ignores the
                // answer will fail on its next fetch, which is the honest
                // outcome; hanging would be worse.
                worker.answer(id, json!({ "finished": false, "cookies": [] }));
                notify(&format!("打不开登录窗口：{error}"), "error", window, cx);
            }
        }
    }
}

/// Show a plugin's notification as a toast.
pub fn notify(message: &str, level: &str, window: &mut Window, cx: &mut App) {
    use gpui_kit::component::notification::Notification;

    let note = match level {
        "success" => Notification::success(message),
        "warning" | "warn" => Notification::warning(message),
        "error" => Notification::error(message),
        _ => Notification::info(message),
    };

    window.push_notification(note, cx);
}

/// Show, move, or take down a plugin's progress bar.
///
/// It lives in the notification stack rather than in the middle column, and it
/// is one notification with one id rather than one per report: a plugin
/// fetching a hundred pages says so a hundred times, and a stack of a hundred
/// toasts is not progress. Reusing the id is what makes each report replace the
/// last, so the bar moves instead of piling up.
///
/// `None` for the message is the plugin saying it is finished, which is the
/// only way this comes down: a progress bar that hid itself on a timer would
/// disappear under a job that is still running.
pub fn progress(message: Option<String>, value: Option<f32>, window: &mut Window, cx: &mut App) {
    use gpui_kit::component::notification::Notification;
    use gpui_kit::component::progress::Progress;

    /// The id every progress report shares, so they replace each other.
    struct PluginProgress;

    let Some(message) = message else {
        window.remove_notification::<PluginProgress>(cx);
        return;
    };

    let note = Notification::new()
        .id::<PluginProgress>()
        // Never: the plugin decides when this is over, not a clock.
        .autohide(false)
        .content(move |_, _, _| {
            let bar = match value {
                Some(value) => Progress::new("plugin-progress").value(value),
                // No value yet: a job whose size the plugin does not know.
                // GPUI's indeterminate bar is what that looks like.
                None => Progress::new("plugin-progress").loading(true),
            };

            v_flex()
                .w_full()
                .gap_2()
                .child(div().text_sm().child(message.clone()))
                .child(bar)
                .into_any_element()
        });

    window.push_notification(note, cx);
}

/// A plugin's message, drawn as prose rather than as a one-line label.
fn body(message: &str, cx: &App) -> AnyElement {
    div()
        .w_full()
        .text_sm()
        .line_height(px(22.))
        .text_color(cx.theme().foreground)
        .child(message.to_owned())
        .into_any_element()
}

/// What a picked item should say.
///
/// The host promised not to understand its contents, so this looks for the
/// words an item is most likely to be carrying and falls back to its JSON
/// rather than inventing anything.
fn label_of(item: &Value) -> String {
    if let Some(text) = item.as_str() {
        return text.to_owned();
    }

    for key in ["label", "title", "name", "text"] {
        if let Some(text) = item.get(key).and_then(Value::as_str) {
            return text.to_owned();
        }
    }

    item.to_string()
}

/// What to do when the user agrees to one of the app's own questions.
pub type ConfirmHandler = Rc<dyn Fn(&mut Window, &mut App)>;

/// A yes/no question the app itself is asking, not a plugin.
///
/// Separate from [`open`] because nothing is waiting on the answer — the answer
/// is an action the user may or may not take — and because these are the app's
/// own questions, which should not be phrased as if a plugin were speaking.
pub fn confirm(
    title: &str,
    message: &str,
    ok: &str,
    on_ok: ConfirmHandler,
    window: &mut Window,
    cx: &mut App,
) {
    let title = title.to_owned();
    let message = message.to_owned();
    let ok_text = ok.to_owned();

    window.open_alert_dialog(cx, move |dialog, _, _| {
        let on_ok = on_ok.clone();
        let message = message.clone();

        dialog
            .w(px(380.))
            .title(title.clone())
            .button_props(
                DialogButtonProps::default()
                    .ok_text(ok_text.clone())
                    .cancel_text("取消")
                    .show_cancel(true),
            )
            .content(move |content, _, cx| content.child(body(&message, cx)))
            .on_ok(move |_, window, cx| {
                on_ok(window, cx);
                true
            })
    });
}

/// What to do with what the user typed.
pub type PromptHandler = Rc<dyn Fn(&str, &mut Window, &mut App)>;

/// A one-line question the app itself is asking.
///
/// The sibling of [`confirm`] for the questions whose answer is a word rather
/// than a yes. It is a separate function rather than a flag on `confirm`
/// because the two are answered differently: a confirmation is answered by the
/// button the user was already reaching for, and a prompt is answered by
/// typing, which means the field has to be focused on open and an empty answer
/// has to be refused rather than accepted as a blank name.
pub fn prompt(
    title: &str,
    initial: &str,
    placeholder: &str,
    ok: &str,
    on_ok: PromptHandler,
    window: &mut Window,
    cx: &mut App,
) {
    let title = title.to_owned();
    let ok_text = ok.to_owned();

    // Created here and focused after the dialog opens. The dialog's content
    // builder is an `Fn` that runs again on any redraw, so an `InputState`
    // made inside it would be replaced mid-typing — caret and all.
    let input = cx.new(|cx| {
        InputState::new(window, cx)
            .placeholder(placeholder.to_owned())
            .default_value(initial.to_owned())
    });
    let focus = input.read(cx).focus_handle(cx);
    window.defer(cx, move |window, cx| focus.focus(window, cx));

    window.open_alert_dialog(cx, move |dialog, _, _| {
        let on_ok = on_ok.clone();
        let input = input.clone();
        let title = title.clone();
        let ok_text = ok_text.clone();

        dialog
            .w(px(380.))
            .title(title)
            .button_props(
                DialogButtonProps::default()
                    .ok_text(ok_text)
                    .cancel_text("取消")
                    .show_cancel(true),
            )
            .content({
                let input = input.clone();
                move |content, _, _| content.child(Input::new(&input).bordered(true))
            })
            .on_ok(move |_, window, cx| {
                let value = input.read(cx).value().trim().to_owned();

                // Returning `false` leaves the dialog open, which is the only
                // honest answer to an empty one: the dialog was opened to
                // collect a name, and closing it on nothing would read as if
                // the name had been taken.
                if value.is_empty() {
                    return false;
                }

                on_ok(&value, window, cx);
                true
            })
    });
}

/// Put `text` on the clipboard and say so.
///
/// Clipboard access is a plugin-free operation here: it is the app copying what
/// it is showing, so it can be offered on any text without asking anything.
pub fn copy(text: &str, window: &mut Window, cx: &mut App) {
    cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string(text.to_owned()));
    notify("已复制", "success", window, cx);
}
