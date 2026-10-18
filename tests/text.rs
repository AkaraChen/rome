//! The two pure functions behind the reading pane and the settings form.
//!
//! These live here rather than beside their modules because a UI module does
//! `use gpui_kit::*`, and that glob brings GPUI's own `#[test]` attribute macro
//! into scope — which shadows the built-in one and expands back into itself
//! until the compiler gives up. Testing from outside the crate is the version
//! that costs nothing to read.
//!
//! Neither function draws anything, which is why they can be tested at all: the
//! rest of the UI is a function of a snapshot, and its correctness is checked by
//! looking at it.

use rome::ui::form;
use rome::ui::reading_pane::{Block, blocks};

use serde_json::{Value, json};

fn schema(text: &str) -> Value {
    serde_json::from_str(text).expect("valid JSON")
}

// ---------------------------------------------------------------------------
// Reading pane: HTML to blocks
// ---------------------------------------------------------------------------

#[test]
fn paragraphs_are_kept_apart() {
    assert_eq!(
        blocks("<p>One.</p><p>Two.</p>"),
        vec![
            Block::Paragraph("One.".to_owned()),
            Block::Paragraph("Two.".to_owned())
        ]
    );
}

#[test]
fn inline_markup_does_not_split_a_paragraph() {
    assert_eq!(
        blocks("<p>A <strong>bold</strong> word.</p>"),
        vec![Block::Paragraph("A bold word.".to_owned())]
    );
}

#[test]
fn scripts_and_styles_are_dropped_whole() {
    assert_eq!(
        blocks("<style>p { color: red }</style><p>Text</p><script>alert(1)</script>"),
        vec![Block::Paragraph("Text".to_owned())]
    );
}

#[test]
fn headings_are_told_from_text() {
    assert_eq!(
        blocks("<h2>Title</h2><p>Body</p>"),
        vec![
            Block::Heading("Title".to_owned()),
            Block::Paragraph("Body".to_owned())
        ]
    );
}

#[test]
fn list_items_become_bullets() {
    assert_eq!(
        blocks("<ul><li>One</li><li>Two</li></ul>"),
        vec![
            Block::Bullet("One".to_owned()),
            Block::Bullet("Two".to_owned())
        ]
    );
}

#[test]
fn quotes_are_kept_as_quotes() {
    assert_eq!(
        blocks("<blockquote>Quoted</blockquote>"),
        vec![Block::Quote("Quoted".to_owned())]
    );
}

#[test]
fn whitespace_collapses() {
    assert_eq!(
        blocks("<p>  one\n\n two\tthree  </p>"),
        vec![Block::Paragraph("one two three".to_owned())]
    );
}

#[test]
fn an_empty_document_has_no_blocks() {
    assert!(blocks("").is_empty());
    assert!(blocks("<p>   </p>").is_empty());
}

#[test]
fn self_closing_br_splits() {
    assert_eq!(
        blocks("one<br>two<br/>three"),
        vec![
            Block::Paragraph("one".to_owned()),
            Block::Paragraph("two".to_owned()),
            Block::Paragraph("three".to_owned())
        ]
    );
}

#[test]
fn a_bare_ampersand_survives() {
    assert_eq!(
        blocks("<p>a & b</p>"),
        vec![Block::Paragraph("a & b".to_owned())]
    );
}

// ---------------------------------------------------------------------------
// Settings form: JSON schema to fields
// ---------------------------------------------------------------------------

#[test]
fn fields_are_read_with_defaults() {
    let fields = form::parse(&schema(
        r#"{"fields":[{"key":"token","label":"Token","type":"password"},{"key":"site"}]}"#,
    ));

    assert_eq!(fields.len(), 2);
    assert_eq!(fields[0].kind, form::Kind::Password);
    // No label means the key stands in for it.
    assert_eq!(fields[1].label, "site");
    assert_eq!(fields[1].kind, form::Kind::Text);
}

#[test]
fn an_unknown_type_is_text() {
    let fields = form::parse(&schema(r#"{"fields":[{"key":"a","type":"color"}]}"#));
    assert_eq!(fields[0].kind, form::Kind::Text);
}

#[test]
fn a_string_type_is_text() {
    // `string` is what the bundled plugins declare; `text` is its synonym.
    let fields = form::parse(&schema(r#"{"fields":[{"key":"a","type":"string"}]}"#));
    assert_eq!(fields[0].kind, form::Kind::Text);
}

#[test]
fn every_documented_type_is_understood() {
    for (kind, expected) in [
        ("password", form::Kind::Password),
        ("number", form::Kind::Number),
        ("textarea", form::Kind::Textarea),
        ("checkbox", form::Kind::Checkbox),
    ] {
        let fields = form::parse(&json!({ "fields": [{ "key": "a", "type": kind }] }));
        assert_eq!(fields[0].kind, expected);
    }
}

#[test]
fn select_options_may_be_bare_strings() {
    let fields = form::parse(&schema(
        r#"{"fields":[{"key":"mode","type":"select","options":["list",{"value":"grid","label":"Grid"}]}]}"#,
    ));

    let form::Kind::Select(options) = &fields[0].kind else {
        panic!("expected a select");
    };

    assert_eq!(options.len(), 2);
    assert_eq!(options[0].label, "list");
    assert_eq!(options[1].label, "Grid");
}

#[test]
fn a_schema_with_no_fields_is_empty() {
    assert!(form::parse(&schema("{}")).is_empty());
    assert!(form::parse(&Value::Null).is_empty());
}

#[test]
fn the_ok_label_can_be_chosen() {
    assert_eq!(form::ok_label(&schema(r#"{"ok":"保存"}"#)), "保存");
    assert_eq!(form::ok_label(&schema("{}")), "确定");
}
