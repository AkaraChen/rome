//! The example plugins that are compiled into the binary.
//!
//! The table in `src/bundled.rs` restates two facts that live in the plugin
//! sources themselves: the id each plugin declares, and the file it came from.
//! It has to — a menu cannot be drawn by running seven plugins — so the risk is
//! not the duplication but the drift. Renaming `plugins/hacker-news.js`, or
//! changing the id inside it, would leave a chooser entry that installs a plugin
//! under a name the app no longer expects, and nothing else in the tree would
//! notice.
//!
//! These tests are that notice. They read the same files through the same
//! `include_str!` and assert the two facts agree.
//!
//! They live outside the crate because `src/ui/mod.rs` and everything under it
//! does `use gpui_kit::*`, which brings GPUI's own `#[test]` attribute into
//! scope and shadows the built-in one. `src/bundled.rs` itself is free of that,
//! but the table it holds is only meaningful next to the code that renders it.

use rome::bundled;

#[test]
fn every_example_declares_the_id_its_slug_implies() {
    for example in bundled::ALL {
        let expected = format!("id: 'rome.{}'", example.slug);

        assert!(
            example.code.contains(&expected),
            "`plugins/{}.js` does not declare `{}`; the chooser would install a \
             plugin under a name this table does not know",
            example.slug,
            expected
        );
    }
}

#[test]
fn every_example_declares_interface_version_one() {
    // `Manifest::parse` refuses anything else, so an example that declared a
    // different version would be offered by the chooser and then rejected by
    // the install dialog — which reads as a broken app rather than as a broken
    // example.
    for example in bundled::ALL {
        assert!(
            example.code.contains("apiVersion: '1'") || example.code.contains("apiVersion: 1"),
            "`plugins/{}.js` declares an interface version the host would refuse",
            example.slug
        );
    }
}

#[test]
fn no_two_examples_share_a_slug() {
    // The slug is the file name on disk, so a collision would mean one example
    // silently overwriting another's copy.
    let mut slugs: Vec<&str> = bundled::ALL.iter().map(|example| example.slug).collect();
    slugs.sort_unstable();

    let count = slugs.len();
    slugs.dedup();

    assert_eq!(count, slugs.len(), "two examples share a slug: {slugs:?}");
}

#[test]
fn every_example_says_what_it_is_for() {
    // The chooser is a list of things to learn from. An entry with no `about`
    // is a name and nothing else, which is the state this table exists to
    // avoid.
    for example in bundled::ALL {
        assert!(
            !example.about.trim().is_empty(),
            "`{}` has nothing to say about itself",
            example.slug
        );
        assert!(
            !example.code.trim().is_empty(),
            "`{}` has no source",
            example.slug
        );
    }
}

#[test]
fn an_example_is_found_by_the_slug_the_chooser_sends_back() {
    // The row's click handler sends the slug it was built with, and the write
    // looks it up again. A slug that does not resolve is a click that does
    // nothing at all.
    for example in bundled::ALL {
        let found = bundled::get(example.slug).expect("the example resolves to itself");

        assert_eq!(found.slug, example.slug);
    }

    assert!(bundled::get("no-such-example").is_none());
}
