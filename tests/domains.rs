//! What the plugin manager's trust panel shows, derived from the transport's
//! request log.
//!
//! `recent_domains` decides which hosts a plugin has touched, in what order,
//! and how many of them a snapshot carries. Every one of those is a decision
//! the card cannot show for itself — a list that leaked a second plugin's
//! domains, or that ignored the cap and grew into every frame, would look
//! exactly like a correct one — so the arithmetic is checked here, on the log
//! alone, through the same `rome::http` the worker reads it from.

use std::collections::VecDeque;

use rome::http::{RequestLog, recent_domains};

/// A log in the order the transport builds one: oldest first. `at` is the
/// index, so a test can reason about which entry is the newest.
fn log(entries: &[(Option<u64>, &str)]) -> VecDeque<RequestLog> {
    entries
        .iter()
        .enumerate()
        .map(|(index, (plugin, url))| RequestLog {
            plugin: *plugin,
            method: "GET".to_owned(),
            url: (*url).to_owned(),
            status: Some(200),
            at: index as i64,
        })
        .collect()
}

#[test]
fn the_newest_host_comes_first_and_repeats_collapse() {
    // example.com is fetched, then another host, then example.com again: the
    // list is what the plugin touches, ordered by how recently, so example.com
    // leads and appears once.
    let log = log(&[
        (Some(1), "https://example.com/a"),
        (Some(1), "https://api.example.com/b"),
        (Some(1), "https://example.com/c"),
    ]);

    assert_eq!(
        recent_domains(&log, 1, 8),
        ["example.com", "api.example.com"]
    );
}

#[test]
fn only_the_named_plugins_requests_count() {
    // The host's own requests (`None`) and another plugin's are both absent:
    // the panel is about one plugin's reach, and anything else in it would be
    // a domain that plugin never touched.
    let log = log(&[
        (Some(1), "https://one.example.com/a"),
        (Some(2), "https://two.example.com/b"),
        (None, "https://host.example.com/c"),
        (Some(1), "https://three.example.com/d"),
    ]);

    assert_eq!(
        recent_domains(&log, 1, 8),
        ["three.example.com", "one.example.com"]
    );
}

#[test]
fn a_plugin_that_has_fetched_nothing_has_no_domains() {
    let log = log(&[(Some(2), "https://example.com/")]);

    assert!(recent_domains(&log, 1, 8).is_empty());
    assert!(recent_domains(&VecDeque::new(), 1, 8).is_empty());
}

#[test]
fn the_cap_keeps_the_newest() {
    let log = log(&[
        (Some(1), "https://a.example.com/"),
        (Some(1), "https://b.example.com/"),
        (Some(1), "https://c.example.com/"),
    ]);

    // Dropping the oldest rather than the newest: a plugin is recognised by
    // what it is talking to now, not by where it once went.
    assert_eq!(
        recent_domains(&log, 1, 2),
        ["c.example.com", "b.example.com"]
    );
}

#[test]
fn a_zero_cap_is_no_domains() {
    let log = log(&[(Some(1), "https://example.com/")]);

    assert!(recent_domains(&log, 1, 0).is_empty());
}

#[test]
fn a_url_with_no_host_is_skipped_not_fatal() {
    // A malformed entry must not end the walk and hide the rest of the log.
    let log = log(&[
        (Some(1), "https://example.com/a"),
        (Some(1), "not a url at all"),
        (Some(1), "mailto:someone@example.com"),
        (Some(1), "https://api.example.com/b"),
    ]);

    assert_eq!(
        recent_domains(&log, 1, 8),
        ["api.example.com", "example.com"]
    );
}

#[test]
fn the_host_is_the_lower_cased_name_without_a_port() {
    let log = log(&[
        (Some(1), "https://EXAMPLE.com/Path"),
        (Some(1), "https://example.com:8443/x"),
    ]);

    assert_eq!(recent_domains(&log, 1, 8), ["example.com"]);
}
