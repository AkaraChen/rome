//! The login window's cookie translation and its request shape.
//!
//! `jar_cookie` is the seam between WebKit and the jar: a cookie that arrives
//! with the wrong domain, or with `host_only` the wrong way round, is sent to
//! the wrong sites — either leaking a session to a sibling domain or losing the
//! one the user just collected. It is a pure function of one cookie, so it can
//! be checked here without a window; the rest of the login window is a webview
//! and is checked by logging in.
//!
//! These live outside the crate because `src/login.rs` does `use gpui_kit::*`,
//! which brings GPUI's own `#[test]` attribute into scope and shadows the
//! built-in one.

use rome::login::jar_cookie;
use rome::plugin::DialogRequest;

use serde_json::json;
use wry::cookie::Cookie;

#[test]
fn a_domain_is_stored_without_the_dot() {
    // The leading dot is the wire's way of saying "this domain and below"; the
    // jar stores the bare domain and keeps that meaning in `host_only`.
    let cookie = Cookie::build(("session", "abc"))
        .domain(".example.com")
        .path("/")
        .build();

    let jar = jar_cookie(&cookie).expect("a cookie with a name and a domain");

    assert_eq!(jar.domain, "example.com");
}

#[test]
fn every_collected_cookie_is_a_domain_cookie() {
    // The `cookie` crate strips the leading dot in every accessor it offers, so
    // "host-only" is not recoverable from a WebKit cookie. Both spellings
    // therefore land as domain cookies — see `login::jar_cookie` for why that
    // is the safe direction: the other one drops the identity provider's
    // parent-domain cookie, which is the whole reason a login window exists.
    for domain in [".example.com", "example.com"] {
        let cookie = Cookie::build(("session", "abc")).domain(domain).build();
        let jar = jar_cookie(&cookie).expect("a cookie with a name and a domain");

        assert!(
            !jar.host_only,
            "{domain} should be stored as a domain cookie"
        );
    }
}

#[test]
fn a_session_cookie_has_no_expiry() {
    // WebKit reports "no expires date" for a session cookie, and that is what
    // `expires_at: None` means to the jar — a cookie that dies with the app.
    let cookie = Cookie::build(("sid", "1")).domain("example.com").build();

    let jar = jar_cookie(&cookie).expect("a cookie with a name and a domain");

    assert_eq!(jar.expires_at, None);
}

#[test]
fn an_expiry_is_carried_across_in_seconds() {
    let expires = wry::cookie::time::OffsetDateTime::from_unix_timestamp(1_800_000_000)
        .expect("a representable timestamp");

    let cookie = Cookie::build(("sid", "1"))
        .domain("example.com")
        .expires(expires)
        .build();

    let jar = jar_cookie(&cookie).expect("a cookie with a name and a domain");

    assert_eq!(jar.expires_at, Some(1_800_000_000));
}

#[test]
fn the_flags_survive() {
    let cookie = Cookie::build(("sid", "1"))
        .domain(".example.com")
        .path("/app")
        .secure(true)
        .http_only(true)
        .build();

    let jar = jar_cookie(&cookie).expect("a cookie with a name and a domain");

    assert_eq!(jar.path, "/app");
    assert!(jar.secure);
    assert!(jar.http_only);
}

#[test]
fn a_cookie_with_nothing_to_store_is_dropped() {
    // No name, or no domain, is a cookie the jar could not file under anything.
    // Silently skipping it is better than inserting a row that would be sent
    // to every host.
    let nameless = Cookie::build(("", "value")).domain("example.com").build();
    assert!(jar_cookie(&nameless).is_none());
}

#[test]
fn login_is_a_ui_request_the_host_understands() {
    let request = DialogRequest::parse(&json!({
        "kind": "login",
        "url": "https://example.com/login"
    }));

    assert_eq!(
        request,
        Some(DialogRequest::Login {
            url: "https://example.com/login".to_owned()
        })
    );
}

#[test]
fn a_login_with_no_url_is_not_a_request() {
    // Nothing to open means nothing the host can do; answering "the host does
    // not know that kind of dialog" is better than opening an empty window.
    assert_eq!(DialogRequest::parse(&json!({ "kind": "login" })), None);
}

#[test]
fn login_blocks_the_plugin() {
    // The plugin's next fetch depends on the answer, so unlike a notification
    // this has to be waited on.
    let request = DialogRequest::Login {
        url: "https://example.com".to_owned(),
    };

    assert!(request.is_blocking());
}
