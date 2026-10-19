//! The plugins that are compiled into the binary.
//!
//! The table in `src/bundled/generated.rs` restates four facts that live in the
//! plugin sources themselves: the id each plugin declares, its name, its
//! description and the view its sources start in. It has to — a market cannot
//! be drawn by running hundreds of plugins — so the risk is not the duplication
//! but the drift. Renaming a file under `plugins/`, or changing the description
//! inside it, would leave a market row that offers the wrong thing, and nothing
//! else in the tree would notice.
//!
//! These tests are that notice. They read the same files through the same
//! `include_str!` and assert the table agrees with them.
//!
//! They live outside the crate because `src/ui/mod.rs` and everything under it
//! does `use gpui_kit::*`, which brings GPUI's own `#[test]` attribute into
//! scope and shadows the built-in one. `src/bundled.rs` itself is free of that,
//! but the table it holds is only meaningful next to the code that renders it.

use rome::bundled;
use rome::models::View;

/// The spelling a manifest uses for `view`, which is not always the spelling a
/// plugin is stored under.
fn manifest_view(view: View) -> &'static str {
    match view {
        View::SocialMedia => "socialMedia",
        other => other.name(),
    }
}

#[test]
fn every_plugin_declares_the_id_a_market_row_expects() {
    for plugin in bundled::ALL {
        let expected = format!("rome.{}", plugin.slug);

        assert_eq!(
            plugin.plugin_id, expected,
            "`{}` names a plugin id the slug does not imply",
            plugin.slug
        );

        let declared = format!("id: '{}'", plugin.plugin_id);

        assert!(
            plugin.code.contains(&declared),
            "`plugins/{}.js` does not declare `{}`; the market would look for a \
             plugin the file does not install",
            plugin.slug,
            declared
        );
    }
}

#[test]
fn every_plugin_declares_interface_version_one() {
    // `Manifest::parse` refuses anything else, so a plugin that declared a
    // different version would be offered by the market and then rejected by
    // the installer — which reads as a broken app rather than a broken plugin.
    for plugin in bundled::ALL {
        assert!(
            plugin.code.contains("apiVersion: '1'") || plugin.code.contains("apiVersion: 1"),
            "`plugins/{}.js` declares an interface version the host would refuse",
            plugin.slug
        );
    }
}

#[test]
fn the_market_repeats_what_each_manifest_says() {
    // The three fields the market draws instead of the manifest. They are the
    // ones a reader makes a decision from, so a stale copy is worse than a
    // missing row: it promises something the installed plugin does not do.
    for plugin in bundled::ALL {
        let name = format!("name: '{}'", plugin.name);
        let description = format!("description: '{}'", plugin.description);
        let view = format!("view: '{}'", manifest_view(plugin.view));

        assert!(
            plugin.code.contains(&name),
            "`plugins/{}.js` does not declare `{}`",
            plugin.slug,
            name
        );
        assert!(
            plugin.code.contains(&description),
            "`plugins/{}.js` does not declare `{}`",
            plugin.slug,
            description
        );
        assert!(
            plugin.code.contains(&view),
            "`plugins/{}.js` does not declare `{}`",
            plugin.slug,
            view
        );
    }
}

#[test]
fn the_market_repeats_each_manifest_icon() {
    // The card grid draws the icon before the plugin has ever run, so this is
    // the one more field the table has to restate. A manifest icon missing
    // from the table would leave a card with a glyph while the installed
    // plugin shows a picture; an icon in the table the manifest does not
    // declare would draw a picture for a plugin that never asked for one.
    for plugin in bundled::ALL {
        match plugin.icon {
            Some(icon) => assert!(
                plugin.code.contains(&format!("icon: '{icon}'")),
                "`plugins/{}.js` does not declare `icon: '{icon}'`",
                plugin.slug
            ),
            None => assert!(
                !plugin.code.contains("  icon: '"),
                "`plugins/{}.js` declares an icon the market does not know about",
                plugin.slug
            ),
        }
    }
}

#[test]
fn no_two_plugins_share_a_slug_or_an_id() {
    // The slug is the file name on disk, so a collision means one plugin
    // silently overwriting another's copy. The id is the install key, so a
    // collision means the second install replaces the first.
    let mut slugs: Vec<&str> = bundled::ALL.iter().map(|plugin| plugin.slug).collect();
    let mut ids: Vec<&str> = bundled::ALL.iter().map(|plugin| plugin.plugin_id).collect();

    let slug_count = slugs.len();
    let id_count = ids.len();

    slugs.sort_unstable();
    slugs.dedup();
    ids.sort_unstable();
    ids.dedup();

    assert_eq!(
        slug_count,
        slugs.len(),
        "two plugins share a slug: {slugs:?}"
    );
    assert_eq!(id_count, ids.len(), "two plugins share an id: {ids:?}");
}

#[test]
fn every_plugin_says_what_it_is_for() {
    // Both strings are drawn: the name on the row, the description under it.
    // An empty one is a row that says nothing about what installing it does.
    for plugin in bundled::ALL {
        assert!(
            !plugin.name.trim().is_empty(),
            "`{}` has no name",
            plugin.slug
        );
        assert!(
            !plugin.description.trim().is_empty(),
            "`{}` has nothing to say about itself",
            plugin.slug
        );
        assert!(
            !plugin.code.trim().is_empty(),
            "`{}` has no source",
            plugin.slug
        );
    }
}

#[test]
fn a_plugin_is_found_by_the_slug_the_market_sends_back() {
    // The row's click handler sends the slug it was built with, and the install
    // looks it up again. A slug that does not resolve is a click that does
    // nothing at all.
    for plugin in bundled::ALL {
        let found = bundled::get(plugin.slug).expect("the plugin resolves to itself");
        assert_eq!(found.slug, plugin.slug);

        let installed = bundled::installed(plugin.plugin_id).expect("the id resolves to its row");
        assert_eq!(installed.slug, plugin.slug);
    }

    assert!(bundled::get("no-such-plugin").is_none());
    assert!(bundled::installed("rome.no-such-plugin").is_none());
}
