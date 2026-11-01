// Copyright (C) 2026 Mcrai Laydam

'use strict';

const Adw = imports.gi.Adw;
const Gdk = imports.gi.Gdk;
const Gtk = imports.gi.Gtk;
const ExtensionUtils = imports.misc.extensionUtils;

function init() {
}

function addChoiceRow(group, settings, key, title, choices) {
    const values = Object.keys(choices);
    const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(Object.values(choices)),
        selected: values.indexOf(settings.get_string(key)),
    });

    row.connect('notify::selected', () => {
        settings.set_string(key, values[row.selected]);
    });

    group.add(row);
    return row;
}

function addSwitchRow(group, settings, key, title) {
    const toggle = new Gtk.Switch({
        active: settings.get_boolean(key),
        valign: Gtk.Align.CENTER,
    });
    const row = new Adw.ActionRow({title, activatable_widget: toggle});

    toggle.connect('notify::active', () => {
        settings.set_boolean(key, toggle.active);
    });

    row.add_suffix(toggle);
    group.add(row);
}

function addSpinRow(group, settings, key, title, lower, upper, step, digits = 0) {
    const isDouble = digits > 0;
    const spin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 5,
        }),
        digits,
        valign: Gtk.Align.CENTER,
    });
    const row = new Adw.ActionRow({title});

    spin.value = isDouble ? settings.get_double(key) : settings.get_int(key);
    spin.connect('value-changed', () => {
        if (isDouble)
            settings.set_double(key, spin.value);
        else
            settings.set_int(key, spin.get_value_as_int());
    });

    row.add_suffix(spin);
    group.add(row);
}

function addColorRow(group, settings, key, title) {
    const rgba = new Gdk.RGBA();

    rgba.parse(settings.get_string(key));

    const button = new Gtk.ColorButton({
        rgba,
        use_alpha: false,
        valign: Gtk.Align.CENTER,
    });
    const row = new Adw.ActionRow({title, activatable_widget: button});

    button.connect('color-set', () => {
        const toHex = channel => Math.round(channel * 255)
            .toString(16)
            .padStart(2, '0');
        const {red, green, blue} = button.get_rgba();

        settings.set_string(key, `#${toHex(red)}${toHex(green)}${toHex(blue)}`);
    });

    row.add_suffix(button);
    group.add(row);
}

function captureShortcut(parent, onCapture) {
    const dialog = new Gtk.Window({
        title: 'Nouveau raccourci',
        transient_for: parent,
        modal: true,
        default_width: 360,
        child: new Gtk.Label({
            label: 'Appuyez sur le raccourci\nÉchap pour annuler, Retour arrière pour l\'effacer',
            justify: Gtk.Justification.CENTER,
            margin_top: 32,
            margin_bottom: 32,
            margin_start: 24,
            margin_end: 24,
        }),
    });
    const controller = new Gtk.EventControllerKey();

    controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
        const mask = state & Gtk.accelerator_get_default_mod_mask();

        if (mask === 0 && keyval === Gdk.KEY_Escape) {
            dialog.close();
        } else if (mask === 0 && keyval === Gdk.KEY_BackSpace) {
            onCapture([]);
            dialog.close();
        } else if (Gtk.accelerator_valid(keyval, mask)) {
            onCapture([Gtk.accelerator_name_with_keycode(
                null, keyval, keycode, mask
            )]);
            dialog.close();
        }

        return Gdk.EVENT_STOP;
    });

    dialog.add_controller(controller);
    dialog.present();
}

function addShortcutRow(group, settings, key, title, window) {
    const label = new Gtk.ShortcutLabel({
        disabled_text: 'Aucun',
        valign: Gtk.Align.CENTER,
    });
    const button = new Gtk.Button({
        child: label,
        valign: Gtk.Align.CENTER,
    });
    const row = new Adw.ActionRow({title, activatable_widget: button});
    const sync = () => {
        label.accelerator = settings.get_strv(key)[0] ?? '';
    };

    button.connect('clicked', () => {
        captureShortcut(window, accelerators => {
            settings.set_strv(key, accelerators);
            sync();
        });
    });
    sync();

    row.add_suffix(button);
    group.add(row);
}

function createGroup(page, title) {
    const group = new Adw.PreferencesGroup({title});

    page.add(group);
    return group;
}

function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings();
    const page = new Adw.PreferencesPage();

    const laser = createGroup(page, 'Laser');

    addChoiceRow(laser, settings, 'activation-mode', 'Activation', {
        always: 'Permanent',
        hold: 'Touche maintenue',
    });
    const holdKeyRow = addChoiceRow(laser, settings, 'hold-key', 'Touche à maintenir', {
        ctrl: 'Ctrl',
        alt: 'Alt',
        shift: 'Maj',
    });
    addChoiceRow(laser, settings, 'pointer-style', 'Style du pointeur', {
        dot: 'Point',
        ring: 'Anneau',
        halo: 'Point lumineux',
    });
    addChoiceRow(laser, settings, 'trail-style', 'Style de la traînée', {
        tapered: 'Effilée',
        continuous: 'Continue',
        none: 'Aucune',
    });
    addSpinRow(laser, settings, 'trail-duration', 'Durée de la traînée (ms)', 200, 2000, 100);
    addSwitchRow(laser, settings, 'hide-cursor', 'Masquer le curseur système');

    const syncHoldKeyRow = () => {
        holdKeyRow.sensitive = settings.get_string('activation-mode') === 'hold';
    };

    settings.connect('changed::activation-mode', syncHoldKeyRow);
    syncHoldKeyRow();

    const appearance = createGroup(page, 'Apparence');

    addColorRow(appearance, settings, 'color', 'Couleur');
    addChoiceRow(appearance, settings, 'size', 'Taille', {
        small: 'Petite',
        medium: 'Moyenne',
        large: 'Grande',
    });
    addSwitchRow(appearance, settings, 'click-effect', 'Cercle à chaque clic');

    const tools = createGroup(page, 'Outils');

    addSpinRow(tools, settings, 'draw-duration', 'Durée du dessin (s)', 1, 60, 1);
    addChoiceRow(tools, settings, 'highlight-color', 'Couleur du surligneur', {
        yellow: 'Jaune',
        green: 'Vert',
        pink: 'Rose',
        blue: 'Bleu',
    });
    addSpinRow(tools, settings, 'highlight-width', 'Épaisseur du surligneur (px)', 8, 80, 2);
    addSpinRow(tools, settings, 'highlight-duration', 'Durée du surlignage (s)', 1, 300, 5);
    addSwitchRow(tools, settings, 'highlight-persist', 'Garder le surlignage jusqu’à l’effacement');
    addSpinRow(tools, settings, 'spotlight-radius', 'Rayon du projecteur (px)', 50, 500, 10);
    addSpinRow(tools, settings, 'spotlight-dim', 'Assombrissement du projecteur (%)', 20, 95, 5);
    addSpinRow(tools, settings, 'magnifier-factor', 'Grossissement de la loupe', 1.5, 5, 0.5, 1);

    const presentation = createGroup(page, 'Mode présentation');

    addSwitchRow(presentation, settings, 'do-not-disturb', 'Couper les notifications');
    addChoiceRow(presentation, settings, 'display-target', 'Écrans', {
        all: 'Tous les écrans',
        primary: 'Écran principal',
    });
    addSpinRow(presentation, settings, 'auto-off-minutes', 'Quitter après inactivité (min, 0 : jamais)', 0, 240, 5);

    const shortcuts = createGroup(page, 'Raccourcis');

    addShortcutRow(shortcuts, settings, 'toggle-presentation', 'Mode présentation', window);
    addShortcutRow(shortcuts, settings, 'tool-laser', 'Laser', window);
    addShortcutRow(shortcuts, settings, 'tool-spotlight', 'Projecteur', window);
    addShortcutRow(shortcuts, settings, 'tool-magnifier', 'Loupe', window);
    addShortcutRow(shortcuts, settings, 'tool-draw', 'Dessin', window);
    addShortcutRow(shortcuts, settings, 'tool-highlight', 'Surligneur', window);
    addShortcutRow(shortcuts, settings, 'clear-annotations', 'Tout effacer', window);

    window.search_enabled = true;
    window.add(page);
}
