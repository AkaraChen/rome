//! Adding a source: pick a plugin file, say what it should read, install it.
//!
//! The flow starts in the window rather than the worker because there is
//! nothing for the worker to do until there is a file to point at. Once there
//! is, the file is read by the worker — installing means running the plugin, so
//! it belongs on the thread that can afford to wait for it.

use std::path::PathBuf;
use std::rc::Rc;

use gpui_kit::component::dialog::{DialogButtonProps, DialogContent};
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::{ActiveTheme, WindowExt, v_flex};
use gpui_kit::*;
use serde_json::{Value, json};

use crate::plugin::session::Manifest;
use crate::worker::{Command, Worker};

use super::form::{self, Form};

/// Ask where the next plugin should come from.
///
/// A chooser rather than the platform's file picker directly, because a fresh
/// install has nothing to read and no way to find out what a plugin is meant to
/// look like: the examples are compiled into the app, and this is the only place
/// they can be reached from. The picker is still one button away, because a
/// plugin the user wrote or downloaded is what this product is actually for.
pub fn choose(window: &mut Window, cx: &mut App, worker: Worker) {
    use gpui_kit::component::dialog::DialogContent;

    window.open_alert_dialog(cx, move |dialog, _, _| {
        let examples = worker.clone();
        let file = worker.clone();

        dialog
            .w(px(460.))
            .title("安装插件")
            .button_props(
                DialogButtonProps::default()
                    .ok_text("从文件安装…")
                    .cancel_text("取消")
                    .show_cancel(true),
            )
            .content({
                let examples = examples.clone();

                move |content: DialogContent, _, cx| {
                    content
                        .child(
                            div()
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .child("内置示例"),
                        )
                        .child(
                            v_flex()
                                .w_full()
                                .gap_1()
                                .mt_1()
                                .children(crate::bundled::ALL.iter().map(|example| {
                                    let worker = examples.clone();

                                    example_row(example, cx).on_click(move |_, window, cx| {
                                        window.close_dialog(cx);
                                        describe_bundled(example.slug, window, cx, worker.clone());
                                    })
                                })),
                        )
                        .child(
                            div()
                                .mt_3()
                                .text_xs()
                                .line_height(px(18.))
                                .text_color(cx.theme().muted_foreground)
                                .child(
                                    "示例插件是编译进 Rome 的，装的时候会在数据目录里写一份副本，\
                                     安装后可以打开读它的源码。",
                                ),
                        )
                }
            })
            .on_ok(move |_, window, cx| {
                pick_file(window, cx, file.clone());
                true
            })
    });
}

/// One example in the chooser: what it is called, and what it is for.
///
/// Not a [`Button`]: the two lines are the point — a name alone says nothing
/// about which example teaches what — and a button draws a label, not a block
/// of text.
fn example_row(example: &crate::bundled::Bundled, cx: &App) -> Stateful<Div> {
    div()
        .id(example.slug)
        .w_full()
        .px_2()
        .py_1p5()
        .rounded_md()
        .cursor_pointer()
        .hover(|this| this.bg(cx.theme().accent.opacity(0.08)))
        .child(
            div()
                .text_sm()
                .text_color(cx.theme().foreground)
                .child(example.name),
        )
        .child(
            div()
                .text_xs()
                .line_height(px(18.))
                .text_color(cx.theme().muted_foreground)
                .child(example.about),
        )
}

/// Write a compiled-in example out and hand it to the worker as a path.
///
/// The write happens here, in the window, rather than as its own command. It is
/// not work that can block on anything but the disk, and putting it on the
/// worker would mean a second way to describe a plugin — one that takes source
/// instead of a path — which is one more thing that could fall out of step with
/// the way a real install works.
fn describe_bundled(slug: &str, window: &mut Window, cx: &mut App, worker: Worker) {
    let Some(example) = crate::bundled::get(slug) else {
        return;
    };

    match crate::paths::write_bundled_plugin(example.slug, example.code) {
        Ok(path) => worker.send(Command::Describe { path }),
        Err(error) => {
            super::dialog::notify(
                &format!("写不出示例插件：{error}"),
                "error",
                window,
                cx,
            );
        }
    }
}

/// Ask the user for a plugin file and describe it.
///
/// The picker is the platform's own — GPUI exposes it through
/// [`App::prompt_for_paths`] and there is no `rfd` dependency to add. The task
/// outlives the click, which is why the worker handle is cloned into it.
fn pick_file(window: &mut Window, cx: &mut App, worker: Worker) {
    let options = PathPromptOptions {
        files: true,
        directories: false,
        multiple: false,
        prompt: Some("选择插件文件".into()),
    };

    let paths = cx.prompt_for_paths(options);

    let task = window.spawn(cx, async move |cx| {
        let Ok(Ok(Some(paths))) = paths.await else {
            // Cancelled, or the platform has no picker. Either way the user
            // sees the window unchanged, which is the right answer to both.
            return;
        };

        let Some(path) = paths.into_iter().next() else {
            return;
        };

        cx.update(|_, _| worker.send(Command::Describe { path }))
            .ok();
    });

    // Held by the executor rather than by the window: the file picker can stay
    // open across several frames, and a task dropped when the click handler
    // returned would cancel the dialog.
    task.detach();
}

/// Show the install dialog for a described plugin.
///
/// `manifest` came back from the worker, which read it out of the file at
/// `path`; both are handed straight back on install so the worker does not have
/// to read and describe the file twice.
pub fn install(
    path: PathBuf,
    manifest: Manifest,
    window: &mut Window,
    cx: &mut App,
    worker: Worker,
) {
    let title = cx.new(|cx| {
        InputState::new(window, cx)
            .placeholder(manifest.name.clone())
            .default_value(manifest.name.clone())
    });

    // `Rc` because a dialog's builder is an `Fn`: it may run again when the
    // dialog layer is rebuilt, so nothing inside it may be consumed by the
    // first run.
    let params = Rc::new(Form::new(&manifest.params, &Value::Null, window, cx));
    let settings = Rc::new(Form::new(&manifest.settings, &Value::Null, window, cx));

    let focus = title.read(cx).focus_handle(cx);
    window.defer(cx, move |window, cx| focus.focus(window, cx));

    let name = manifest.name.clone();
    let file = path.display().to_string();

    window.open_alert_dialog(cx, move |dialog, _, _| {
        // Separate bindings for the builder and for the button: both closures
        // must be `Fn`, and a `move` that consumes the entity would leave the
        // second one with nothing to clone.
        let content_name = name.clone();
        let content_file = file.clone();
        let content_title = title.clone();
        let content_params = params.clone();
        let content_settings = settings.clone();

        let content = move |mut content: DialogContent, _: &mut Window, cx: &mut App| {
            content = content
                .child(label("插件", cx))
                .child(
                    div()
                        .text_sm()
                        .text_color(cx.theme().foreground)
                        .child(content_name.clone()),
                )
                .child(
                    div()
                        .text_xs()
                        .font_family("monospace")
                        .text_color(cx.theme().muted_foreground)
                        .child(content_file.clone()),
                )
                .child(div().mt_2().child(label("名称", cx)))
                .child(Input::new(&content_title).bordered(true));

            if !content_params.is_empty() {
                content = content
                    .child(div().mt_2().child(label("要抓取什么", cx)))
                    .child(content_params.render(cx));
            }

            if !content_settings.is_empty() {
                content = content
                    .child(div().mt_2().child(label("设置", cx)))
                    .child(content_settings.render(cx));
            }

            content
        };

        let ok = worker.clone();
        let path = path.clone();
        let ok_title = title.clone();
        let ok_params = params.clone();
        let ok_settings = settings.clone();

        dialog
            .w(px(480.))
            .title("添加信息源")
            .button_props(
                DialogButtonProps::default()
                    .ok_text("安装")
                    .cancel_text("取消")
                    .show_cancel(true),
            )
            .content(content)
            .on_ok(move |_, _, cx| {
                ok.send(Command::Install {
                    path: path.clone(),
                    title: ok_title.read(cx).value().to_string(),
                    // An empty form is not "no settings" — it is a plugin that
                    // declared none, and `{}` says so without a special case.
                    settings: if ok_settings.is_empty() {
                        json!({})
                    } else {
                        ok_settings.value(cx)
                    },
                    params: if ok_params.is_empty() {
                        json!({})
                    } else {
                        ok_params.value(cx)
                    },
                });
                true
            })
    });
}

/// A form's heading, in the size the rest of the dialog's labels use.
fn label(text: &str, cx: &App) -> AnyElement {
    div()
        .text_xs()
        .text_color(cx.theme().muted_foreground)
        .child(text.to_owned())
        .into_any_element()
}

/// The dialog for correcting an installed source's parameters.
///
/// Reached from the middle column's header. Reinstalling would also work, but
/// it would make a new plugin row and lose the entries the old one had already
/// collected — separating "what it reads" from "what it is installed as" is why
/// the parameters are a field of the source rather than of the plugin.
pub fn edit(
    source_id: u64,
    title: &str,
    params_schema: &Value,
    current_params: &Value,
    window: &mut Window,
    cx: &mut App,
    worker: Worker,
) {
    let params = Rc::new(Form::new(params_schema, current_params, window, cx));

    let name = cx.new(|cx| InputState::new(window, cx).default_value(title.to_owned()));
    let focus = name.read(cx).focus_handle(cx);
    window.defer(cx, move |window, cx| focus.focus(window, cx));

    let ok_text = form::ok_label(params_schema);

    window.open_alert_dialog(cx, move |dialog, _, _| {
        let content_name = name.clone();
        let content_params = params.clone();

        let content = move |content: DialogContent, _: &mut Window, cx: &mut App| {
            let content = content
                .child(label("名称", cx))
                .child(Input::new(&content_name).bordered(true));

            if content_params.is_empty() {
                content
            } else {
                content
                    .child(div().mt_2().child(label("要抓取什么", cx)))
                    .child(content_params.render(cx))
            }
        };

        let ok = worker.clone();
        let ok_name = name.clone();
        let ok_params = params.clone();
        let ok_text = ok_text.clone();

        dialog
            .w(px(460.))
            .title("信息源设置")
            .button_props(
                DialogButtonProps::default()
                    .ok_text(ok_text)
                    .cancel_text("取消")
                    .show_cancel(true),
            )
            .content(content)
            .on_ok(move |_, _, cx| {
                ok.send(Command::SetSourceParams {
                    source_id,
                    title: ok_name.read(cx).value().to_string(),
                    params: ok_params.value(cx),
                });
                true
            })
    });
}

/// The dialog shown before a source is forgotten.
///
/// Removing a source throws away every entry it collected, and there is no
/// undo — the entries came from a server that may no longer serve them. So the
/// question is asked, and it names what is about to go.
pub fn confirm_remove(
    source_id: u64,
    title: &str,
    dispatch: &super::Dispatch,
    window: &mut Window,
    cx: &mut App,
) {
    let go = dispatch.clone();
    let message = format!(
        "「{title}」和它抓到的所有条目都会被删掉，这个操作不能撤销。插件本身不受影响。"
    );

    super::dialog::confirm(
        "移除信息源？",
        &message,
        "移除",
        std::rc::Rc::new(move |window, cx| {
            go(
                super::Action::Worker(Command::DeleteSource(source_id)),
                window,
                cx,
            );
        }),
        window,
        cx,
    );
}

/// The settings dialog for an installed plugin, reached from the plugin
/// manager.
///
/// Separate from [`edit`] because a plugin's settings are one object shared by
/// every source it has, while a source's parameters differ per subscription.
pub fn edit_plugin(
    plugin_id: u64,
    settings_schema: &Value,
    current: &Value,
    window: &mut Window,
    cx: &mut App,
    worker: Worker,
) {
    let form = Rc::new(Form::new(settings_schema, current, window, cx));
    if form.is_empty() {
        return;
    }

    let ok_text = form::ok_label(settings_schema);

    window.open_alert_dialog(cx, move |dialog, _, _| {
        let content_form = form.clone();
        let content = move |content: DialogContent, _: &mut Window, cx: &mut App| {
            content.child(content_form.render(cx))
        };

        let ok = worker.clone();
        let ok_form = form.clone();
        let ok_text = ok_text.clone();

        dialog
            .w(px(460.))
            .title("插件设置")
            .button_props(
                DialogButtonProps::default()
                    .ok_text(ok_text)
                    .cancel_text("取消")
                    .show_cancel(true),
            )
            .content(content)
            .on_ok(move |_, _, cx| {
                ok.send(Command::SetPluginSettings {
                    plugin_id,
                    settings: ok_form.value(cx),
                });
                true
            })
    });
}
