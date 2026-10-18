//! The closed set of requests a plugin can make of the host.
//!
//! Two things are being checked, and both are contracts rather than
//! implementation. The first is the list itself: a plugin author writes
//! `ctx.ui.form(...)` against the published runtime, so a kind the host
//! silently stopped understanding would break a plugin that is doing nothing
//! wrong. The second is which of them wait for a person — `is_blocking` is what
//! decides whether a plugin's own deadline is paused while it waits, and
//! whether the request survives a run with no window in front of it. Getting
//! that set wrong in one direction hangs a plugin behind a toast nobody is
//! looking at; in the other, it kills a plugin that is waiting for someone to
//! type an API key.
//!
//! These live outside the crate because `src/plugin/mod.rs` is reached through
//! `rome::plugin`, and the crate's UI modules do `use gpui_kit::*`, which
//! brings GPUI's own `#[test]` attribute into scope and shadows the built-in
//! one.

use rome::plugin::DialogRequest;

use serde_json::json;

/// Every kind, as a plugin would send it, with the request it must become.
fn vocabulary() -> Vec<(&'static str, serde_json::Value, DialogRequest)> {
    vec![
        (
            "alert",
            json!({ "kind": "alert", "message": "hi" }),
            DialogRequest::Alert {
                message: "hi".to_owned(),
            },
        ),
        (
            "confirm",
            json!({ "kind": "confirm", "message": "sure?" }),
            DialogRequest::Confirm {
                message: "sure?".to_owned(),
            },
        ),
        (
            "prompt",
            json!({ "kind": "prompt", "message": "key?", "title": "T", "placeholder": "p", "secret": true }),
            DialogRequest::Prompt {
                message: "key?".to_owned(),
                title: Some("T".to_owned()),
                placeholder: Some("p".to_owned()),
                secret: true,
            },
        ),
        (
            "notify",
            json!({ "kind": "notify", "message": "done", "level": "success" }),
            DialogRequest::Notify {
                message: "done".to_owned(),
                level: "success".to_owned(),
            },
        ),
        (
            "form",
            json!({ "kind": "form", "schema": { "fields": [] } }),
            DialogRequest::Form {
                schema: json!({ "fields": [] }),
            },
        ),
        (
            "pick",
            json!({ "kind": "pick", "items": ["a", "b"] }),
            DialogRequest::Pick {
                items: vec![json!("a"), json!("b")],
            },
        ),
        (
            "login",
            json!({ "kind": "login", "url": "https://example.com/login" }),
            DialogRequest::Login {
                url: "https://example.com/login".to_owned(),
            },
        ),
        (
            "progress",
            json!({ "kind": "progress", "message": "fetching", "value": 0.5 }),
            DialogRequest::Progress {
                message: Some("fetching".to_owned()),
                value: Some(0.5),
            },
        ),
        (
            "openExternal",
            json!({ "kind": "openExternal", "url": "https://example.com" }),
            DialogRequest::OpenExternal {
                url: "https://example.com".to_owned(),
            },
        ),
    ]
}

#[test]
fn every_kind_a_plugin_can_send_is_understood() {
    for (kind, sent, expected) in vocabulary() {
        assert_eq!(
            DialogRequest::parse(&sent),
            Some(expected),
            "the host did not understand `{kind}`"
        );
    }
}

#[test]
fn the_questions_are_the_ones_that_wait() {
    // Spelled out rather than derived from the list above, because this is the
    // answer the rest of the host is written against: if a new question is
    // added and lands in the wrong set, this is the test that should fail.
    let waiting = ["alert", "confirm", "prompt", "form", "pick", "login"];
    let reported = ["notify", "progress", "openExternal"];

    for (kind, _, request) in vocabulary() {
        let expected = waiting.contains(&kind);
        assert_eq!(
            request.is_blocking(),
            expected,
            "`{kind}` is in the wrong set"
        );

        if reported.contains(&kind) {
            assert!(!request.is_blocking());
        }
    }
}

#[test]
fn a_progress_report_may_leave_out_the_size() {
    // `{ message }` alone is a job whose length the plugin does not know yet.
    // It is not an error and it is not zero: a bar sitting at 0% for a minute
    // says the job has not started, which is the opposite of what is true.
    let request = DialogRequest::parse(&json!({ "kind": "progress", "message": "working" }));

    assert_eq!(
        request,
        Some(DialogRequest::Progress {
            message: Some("working".to_owned()),
            value: None,
        })
    );
}

#[test]
fn an_empty_progress_report_is_the_instruction_to_stop() {
    // No message at all is how a plugin takes the bar down. Read as "a report
    // with a missing field" it would be dropped, and the bar would stay up
    // forever under a job that finished.
    let request = DialogRequest::parse(&json!({ "kind": "progress", "message": null }));

    assert_eq!(
        request,
        Some(DialogRequest::Progress {
            message: None,
            value: None,
        })
    );
}

#[test]
fn a_progress_value_outside_the_range_is_pinned_to_it() {
    // A plugin that divides its way to 1.0000001 has done nothing wrong and has
    // no way to handle an error about it, so the value is clamped rather than
    // refused.
    let over = DialogRequest::parse(&json!({ "kind": "progress", "value": 1.5 }));
    let under = DialogRequest::parse(&json!({ "kind": "progress", "value": -2 }));

    assert_eq!(
        over,
        Some(DialogRequest::Progress {
            message: None,
            value: Some(1.0),
        })
    );
    assert_eq!(
        under,
        Some(DialogRequest::Progress {
            message: None,
            value: Some(0.0),
        })
    );
}

#[test]
fn an_open_with_no_url_is_not_a_request() {
    // Nothing to open, and answering `{ "opened": true }` for nothing would be
    // a lie the plugin could not detect.
    assert_eq!(
        DialogRequest::parse(&json!({ "kind": "openExternal" })),
        None
    );
}

#[test]
fn an_unknown_kind_is_not_a_request() {
    // The runtime is the contract; the host refuses what it does not know
    // rather than guessing at a kind added after it was built.
    assert_eq!(
        DialogRequest::parse(&json!({ "kind": "progressBar", "message": "x" })),
        None
    );
}
