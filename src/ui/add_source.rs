//! Installing a plugin from a file, and editing what is already installed.
//!
//! The add-source page lives in [`super::wizard`]. What is left here is the
//! half that starts at the platform's file picker: a file has
//! to be described before it can be offered, and describing it is the worker's
//! job because describing means running it. The dialogs that correct an
//! installed source or plugin stay here too — they are the same kind of
//! question, asked about something that already exists.

use std::path::PathBuf;
use std::rc::Rc;

use gpui_kit::component::dialog::{DialogButtonProps, DialogContent};
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::{ActiveTheme, WindowExt};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use serde_json::Value;

use crate::plugin::session::Manifest;
use crate::worker::{Command, Worker};

use super::form::{self, Form};

/// Ask the user for a plugin file and describe it.
///
/// The picker is the platform's own — GPUI exposes it through
/// [`App::prompt_for_paths`] and there is no `rfd` dependency to add. The task
/// outlives the click, which is why the worker handle is cloned into it.
pub fn pick_file(window: &mut Window, cx: &mut App, worker: Worker) {
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

/// Show the confirmation for a described plugin.
///
/// `manifest` came back from the worker, which read it out of the file at
/// `path`; both are handed straight back on install so the worker does not have
/// to read and describe the file twice.
///
/// The dialog reads the file's manifest rather than asking for a name and a
/// form, because installing and subscribing are now separate decisions. What
/// the user is agreeing to here is running this code, and the two facts that
/// belong to that decision are what the plugin calls itself and what it says it
/// does. Everything about a subscription is the wizard's.
pub fn confirm_install(
    path: PathBuf,
    manifest: Manifest,
    window: &mut Window,
    cx: &mut App,
    worker: Worker,
) {
    let name = manifest.name.clone();
    let description = manifest
        .description
        .clone()
        .filter(|description| !description.trim().is_empty());
    let file = path.display().to_string();

    window.open_alert_dialog(cx, move |dialog, _, _| {
        // Separate bindings for the builder and for the button: both closures
        // must be `Fn`, and a `move` that consumes a value would leave the
        // second one with nothing to clone.
        let content_name = name.clone();
        let content_description = description.clone();
        let content_file = file.clone();

        let content = move |content: DialogContent, _: &mut Window, cx: &mut App| {
            content
                .child(label("插件", cx))
                .child(
                    div()
                        .text_base()
                        .line_height(px(24.))
                        .font_weight(FontWeight(450.))
                        .text_color(cx.theme().foreground)
                        .child(content_name.clone()),
                )
                .when_some(content_description.clone(), |this, description| {
                    this.child(
                        div()
                            .mt_1()
                            .text_sm()
                            .line_height(px(22.))
                            .text_color(cx.theme().muted_foreground)
                            .child(description),
                    )
                })
                .child(
                    div()
                        .mt_2()
                        .text_size(px(crate::theme::LABEL))
                        .font_family("monospace")
                        .text_color(cx.theme().muted_foreground)
                        .child(content_file.clone()),
                )
                .child(
                    div()
                        .mt_3()
                        .text_size(px(crate::theme::LABEL))
                        .line_height(px(18.))
                        .text_color(cx.theme().muted_foreground)
                        .child("装好后，到「添加信息源」里给它添加订阅。"),
                )
        };

        let install = worker.clone();
        let path = path.clone();

        dialog
            .w(px(460.))
            .title("安装插件")
            .button_props(
                DialogButtonProps::default()
                    .ok_text("安装")
                    .cancel_text("取消")
                    .show_cancel(true),
            )
            .content(content)
            .on_ok(move |_, _, _| {
                install.send(Command::InstallPlugin { path: path.clone() });
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
    let message =
        format!("「{title}」和它抓到的所有条目都会被删掉，这个操作不能撤销。插件本身不受影响。");

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
