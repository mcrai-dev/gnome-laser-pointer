// Copyright (C) 2026 Mcrai Laydam

'use strict';

const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const MAX_POINTS = 96;
const FRAME_INTERVAL_MS = 16;
const RIPPLE_SIZE = 64;
const RIPPLE_DURATION_MS = 400;
const INK_FADE_MS = 500;
const HIGHLIGHT_OPACITY = 110;
const HIGHLIGHT_COLORS = {yellow: '#ffe600', green: '#39d96b', pink: '#ff5ca8', blue: '#42b6ff'};

const SIZES = {
    small: {trail: 4, pointer: 8},
    medium: {trail: 7, pointer: 12},
    large: {trail: 11, pointer: 18},
};

const HOLD_MASKS = {
    ctrl: Clutter.ModifierType.CONTROL_MASK,
    alt: Clutter.ModifierType.MOD1_MASK,
    shift: Clutter.ModifierType.SHIFT_MASK,
};

const CLICK_MASK = Clutter.ModifierType.BUTTON1_MASK |
    Clutter.ModifierType.BUTTON3_MASK;

const TOOLS = [
    {id: 'laser', label: 'Laser', shortcut: 'tool-laser'},
    {id: 'spotlight', label: 'Projecteur', shortcut: 'tool-spotlight'},
    {id: 'magnifier', label: 'Loupe', shortcut: 'tool-magnifier'},
    {id: 'draw', label: 'Dessin (Échap pour quitter)', shortcut: 'tool-draw'},
    {id: 'highlight', label: 'Surligneur (Échap pour quitter)', shortcut: 'tool-highlight'},
];

const CAPTURE_TOOLS = ['draw', 'highlight'];

const SHORTCUT_KEYS = [
    'toggle-presentation',
    'clear-annotations',
    ...TOOLS.map(tool => tool.shortcut),
];

class LaserPointerExtension {
    enable() {
        this._settings = ExtensionUtils.getSettings();
        this._notifications = new Gio.Settings({
            schema_id: 'org.gnome.desktop.notifications',
        });
        this._cursorTracker = Meta.CursorTracker.get_for_display(global.display);
        this._active = false;
        this._tool = 'laser';
        this._frameId = null;

        this._button = new PanelMenu.Button(0.0, 'Laser Pointer', false);
        this._icon = new St.Icon({
            icon_name: 'find-location-symbolic',
            style_class: 'system-status-icon',
        });
        this._button.add_child(this._icon);

        this._switch = new PopupMenu.PopupSwitchMenuItem(
            'Mode présentation', false
        );
        this._switch.connect('toggled', (_item, active) => {
            this._setActive(active);
        });
        this._button.menu.addMenuItem(this._switch);
        this._button.menu.addMenuItem(
            new PopupMenu.PopupSeparatorMenuItem()
        );

        this._toolItems = new Map();
        for (const tool of TOOLS) {
            const item = new PopupMenu.PopupMenuItem(tool.label);

            item.connect('activate', () => this._selectTool(tool.id));
            this._button.menu.addMenuItem(item);
            this._toolItems.set(tool.id, item);
        }
        this._syncToolItems();

        this._button.menu.addMenuItem(
            new PopupMenu.PopupSeparatorMenuItem()
        );

        const clearItem = new PopupMenu.PopupMenuItem('Tout effacer');
        clearItem.connect('activate', () => this._clearAnnotations());
        this._button.menu.addMenuItem(clearItem);

        const prefsItem = new PopupMenu.PopupMenuItem('Paramètres');
        prefsItem.connect('activate', () => ExtensionUtils.openPrefs());
        this._button.menu.addMenuItem(prefsItem);

        Main.panel.addToStatusArea('laser-pointer', this._button);

        this._addKeybinding(
            'toggle-presentation', () => this._setActive(!this._active)
        );
        for (const tool of TOOLS)
            this._addKeybinding(tool.shortcut, () => this._selectTool(tool.id));
        this._addKeybinding('clear-annotations', () => this._clearAnnotations());

        this._settingsId = this._settings.connect('changed', (_settings, key) => {
            if (this._active && !SHORTCUT_KEYS.includes(key))
                this._restart();
        });
    }

    _addKeybinding(key, handler) {
        Main.wm.addKeybinding(
            key,
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.ALL,
            handler
        );
    }

    _setActive(active) {
        if (active === this._active)
            return;

        this._active = active;
        this._switch.setToggleState(active);
        this._icon.set_style(
            active ? `color: ${this._settings.get_string('color')};` : null
        );

        if (active) {
            this._startPresentation();
        } else {
            this._stopPresentation();
        }
    }

    _selectTool(id) {
        if (this._active && id === this._tool)
            return;

        if (this._active)
            this._leaveTool();

        this._tool = id;
        this._syncToolItems();

        if (this._active)
            this._enterTool();
        else
            this._setActive(true);
    }

    _syncToolItems() {
        for (const [id, item] of this._toolItems) {
            item.setOrnament(id === this._tool
                ? PopupMenu.Ornament.DOT
                : PopupMenu.Ornament.NONE);
        }
    }

    _restart() {
        this._stopPresentation();
        this._startPresentation();
        this._icon.set_style(`color: ${this._settings.get_string('color')};`);
    }

    _readConfig() {
        const s = this._settings;

        return {
            activationMode: s.get_string('activation-mode'),
            holdMask: HOLD_MASKS[s.get_string('hold-key')],
            color: s.get_string('color'),
            size: SIZES[s.get_string('size')],
            pointerStyle: s.get_string('pointer-style'),
            trailStyle: s.get_string('trail-style'),
            trailDuration: s.get_int('trail-duration'),
            hideCursor: s.get_boolean('hide-cursor'),
            clickEffect: s.get_boolean('click-effect'),
            drawDuration: s.get_int('draw-duration') * 1000,
            highlightColor: HIGHLIGHT_COLORS[s.get_string('highlight-color')],
            highlightWidth: s.get_int('highlight-width'),
            highlightDuration: s.get_int('highlight-duration') * 1000,
            highlightPersist: s.get_boolean('highlight-persist'),
            spotlightRadius: s.get_int('spotlight-radius'),
            spotlightDim: s.get_int('spotlight-dim') / 100,
            magnifierFactor: s.get_double('magnifier-factor'),
            doNotDisturb: s.get_boolean('do-not-disturb'),
            primaryOnly: s.get_string('display-target') === 'primary',
            autoOffMs: s.get_int('auto-off-minutes') * 60000,
        };
    }

    _startPresentation() {
        this._config = this._readConfig();
        this._points = [];
        this._ripples = [];
        this._ink = [];
        this._highlights = [];
        this._stroke = 0;
        this._wasDrawing = false;
        this._wasPressed = false;
        this._lastPointer = null;
        this._lastActivity = GLib.get_monotonic_time() / 1000;

        // On retient l'état d'origine : l'utilisateur a pu déjà couper ses
        // notifications, et il faut le lui rendre tel quel
        if (this._config.doNotDisturb) {
            this._savedBanners = this._notifications.get_boolean('show-banners');
            this._notifications.set_boolean('show-banners', false);
        }

        // Sans ça, GNOME contourne son propre affichage pour les fenêtres en
        // plein écran, et les effets n'y seraient pas visibles
        Meta.disable_unredirect_for_display(global.display);

        this._createOverlay();
        this._enterTool();

        this._frameId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, FRAME_INTERVAL_MS, () => {
                this._onFrame();
                return this._frameId ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            }
        );
    }

    _stopPresentation() {
        GLib.source_remove(this._frameId);
        this._frameId = null;

        this._leaveTool();

        this._overlay.destroy();
        this._overlay = null;
        this._segments = null;
        this._pointer = null;
        this._spotlight = null;
        this._points = null;
        this._ripples = null;
        this._ink = null;
        this._highlights = null;

        Meta.enable_unredirect_for_display(global.display);

        if (this._config.doNotDisturb)
            this._notifications.set_boolean('show-banners', this._savedBanners);
    }

    _createOverlay() {
        const {color, size, primaryOnly} = this._config;

        this._overlay = new Clutter.Actor({
            reactive: false,
            width: global.stage.width,
            height: global.stage.height,
        });

        if (primaryOnly) {
            const monitor = Main.layoutManager.primaryMonitor;

            this._overlay.set_clip(
                monitor.x, monitor.y, monitor.width, monitor.height
            );
        }

        Main.uiGroup.add_child(this._overlay);
        Main.uiGroup.set_child_above_sibling(this._overlay, null);

        this._spotlight = this._createSpotlight();
        this._overlay.add_child(this._spotlight);

        this._segments = [];
        for (let i = 0; i < MAX_POINTS - 1; i++) {
            const segment = this._createStroke(size.trail);

            segment.visible = false;
            this._overlay.add_child(segment);
            this._segments.push(segment);
        }

        this._pointer = new St.Widget({
            style: this._getPointerStyle(color, size.pointer),
            width: size.pointer,
            height: size.pointer,
            visible: false,
        });
        this._overlay.add_child(this._pointer);
    }

    _createStroke(width, color = this._config.color) {
        return new St.Widget({
            style: `background-color: ${color}; border-radius: ${width}px;`,
        });
    }

    _getPointerStyle(color, size) {
        const radius = `border-radius: ${size}px;`;

        switch (this._config.pointerStyle) {
        case 'ring':
            return `border: ${Math.ceil(size / 5)}px solid ${color}; ${radius}`;
        case 'halo':
            return `background-color: ${color}; ${radius} ` +
                `box-shadow: 0 0 ${size * 2}px ${Math.ceil(size / 2)}px ${color};`;
        default:
            return `background-color: ${color}; ${radius}`;
        }
    }

    // Texture deux fois plus grande que l'écran, dessinée une seule fois : pour
    // suivre la souris, il suffit ensuite de la déplacer
    _createSpotlight() {
        const {spotlightRadius: radius, spotlightDim: dim} = this._config;
        const width = global.stage.width * 2;
        const height = global.stage.height * 2;
        const spotlight = new St.DrawingArea({width, height, visible: false});

        spotlight.connect('repaint', area => {
            const context = area.get_context();
            const gradient = new Cairo.RadialGradient(
                width / 2, height / 2, radius,
                width / 2, height / 2, radius * 1.15
            );

            gradient.addColorStopRGBA(0, 0, 0, 0, 0);
            gradient.addColorStopRGBA(1, 0, 0, 0, dim);
            context.setSource(gradient);
            context.paint();
            context.$dispose();
        });

        return spotlight;
    }

    _enterTool() {
        switch (this._tool) {
        case 'spotlight':
            this._spotlight.visible = true;
            break;
        case 'magnifier':
            this._startMagnifier();
            break;
        case 'draw':
        case 'highlight':
            this._startDrawing();
            break;
        }

        this._cursorTracker.set_pointer_visible(
            !(this._tool === 'laser' && this._config.hideCursor)
        );
    }

    _leaveTool() {
        switch (this._tool) {
        case 'laser':
            this._points.length = 0;
            this._segments.forEach(segment => (segment.visible = false));
            this._pointer.visible = false;
            this._wasDrawing = false;
            break;
        case 'spotlight':
            this._spotlight.visible = false;
            break;
        case 'magnifier':
            this._stopMagnifier();
            break;
        case 'draw':
        case 'highlight':
            this._stopDrawing();
            break;
        }

        this._cursorTracker.set_pointer_visible(true);
    }

    // La loupe de GNOME est pilotée sans toucher aux réglages d'accessibilité
    _startMagnifier() {
        const [region] = Main.magnifier.getZoomRegions();
        const factor = this._config.magnifierFactor;

        this._savedMagnifier = {
            active: Main.magnifier.isActive(),
            factor: region.getMagFactor(),
        };
        region.setMagFactor(factor, factor);
        Main.magnifier.setActive(true);
    }

    _stopMagnifier() {
        const [region] = Main.magnifier.getZoomRegions();

        region.setMagFactor(...this._savedMagnifier.factor);
        Main.magnifier.setActive(this._savedMagnifier.active);
    }

    // Dessiner capture la souris : les clics ne vont plus aux applications,
    // et le panneau devient inaccessible jusqu'à Échap
    _startDrawing() {
        this._capture = new Clutter.Actor({
            reactive: true,
            width: global.stage.width,
            height: global.stage.height,
        });
        this._overlay.add_child(this._capture);
        this._inkPoint = null;
        this._highlightStroke = null;

        this._capture.connect('button-press-event', (_actor, event) => {
            const [x, y] = event.get_coords();

            this._inkPoint = {x, y};
            if (this._tool === 'highlight')
                this._beginHighlight(x, y);
            return Clutter.EVENT_STOP;
        });
        this._capture.connect('motion-event', (_actor, event) => {
            if (this._inkPoint) {
                const [x, y] = event.get_coords();

                if (this._tool === 'highlight') {
                    this._extendHighlight(x, y, event.get_state());
                } else {
                    this._addInk(this._inkPoint, {x, y});
                    this._inkPoint = {x, y};
                }
            }
            return Clutter.EVENT_STOP;
        });
        this._capture.connect('button-release-event', () => {
            this._endHighlight();
            this._inkPoint = null;
            return Clutter.EVENT_STOP;
        });
        this._capture.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();

            if (key === Clutter.KEY_Escape)
                this._selectTool('laser');
            else if (key === Clutter.KEY_Delete)
                this._clearAnnotations();
            return Clutter.EVENT_STOP;
        });

        this._grab = Main.pushModal(this._capture, {
            actionMode: Shell.ActionMode.ALL,
        });
        global.display.set_cursor(Meta.Cursor.CROSSHAIR);
    }

    _stopDrawing() {
        this._endHighlight();
        global.display.set_cursor(Meta.Cursor.DEFAULT);
        Main.popModal(this._grab);
        this._grab = null;
        this._capture.destroy();
        this._capture = null;
        this._inkPoint = null;
    }

    // Le trait est aplati avant d'être rendu translucide : ses segments se
    // chevauchent sans faire de taches plus foncées
    _beginHighlight(x, y) {
        this._highlightStroke = new Clutter.Actor({
            offscreen_redirect: Clutter.OffscreenRedirect.ALWAYS,
            opacity: HIGHLIGHT_OPACITY,
        });
        this._overlay.insert_child_below(this._highlightStroke, this._pointer);
        this._highlightStart = {x, y};
        this._addHighlightSegment({x, y}, {x, y});
    }

    _addHighlightSegment(from, to) {
        const {highlightWidth: width, highlightColor: color} = this._config;
        const segment = this._createStroke(width, color);

        this._placeStroke(segment, from, to, width);
        this._highlightStroke.add_child(segment);
    }

    // Maj maintenue : le trait reste horizontal, à la hauteur de son départ
    _extendHighlight(x, y, state) {
        if (!this._highlightStroke)
            return;

        if (state & Clutter.ModifierType.SHIFT_MASK) {
            this._highlightStroke.destroy_all_children();
            this._addHighlightSegment(this._highlightStart, {x, y: this._highlightStart.y});
            this._inkPoint = {x, y: this._highlightStart.y};
            return;
        }

        this._addHighlightSegment(this._inkPoint, {x, y});
        this._inkPoint = {x, y};
    }

    _endHighlight() {
        if (!this._highlightStroke)
            return;

        this._highlights.push({
            actor: this._highlightStroke,
            time: GLib.get_monotonic_time() / 1000,
        });
        this._highlightStroke = null;
    }

    _clearAnnotations() {
        if (!this._active)
            return;

        this._endHighlight();
        for (const {actor} of [...this._ink, ...this._highlights])
            actor.destroy();
        this._ink = [];
        this._highlights = [];
    }

    _addInk(from, to) {
        const width = this._config.size.trail;
        const actor = this._createStroke(width);

        this._placeStroke(actor, from, to, width);
        this._overlay.insert_child_below(actor, this._pointer);
        this._ink.push({actor, time: GLib.get_monotonic_time() / 1000});
    }

    _placeStroke(actor, from, to, width) {
        const length = Math.hypot(to.x - from.x, to.y - from.y) + width;

        actor.set_size(length, width);
        actor.set_position(from.x - width / 2, from.y - width / 2);
        actor.set_pivot_point(width / 2 / length, 0.5);
        actor.rotation_angle_z =
            Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
    }

    _isLaserDrawing(mods) {
        return this._config.activationMode === 'always' ||
            (mods & this._config.holdMask) !== 0;
    }

    _onFrame() {
        const [x, y, mods] = global.get_pointer();
        const now = GLib.get_monotonic_time() / 1000;
        const last = this._lastPointer;

        if (!last || last.x !== x || last.y !== y) {
            this._lastPointer = {x, y};
            this._lastActivity = now;
        } else if (this._config.autoOffMs > 0 &&
                   now - this._lastActivity > this._config.autoOffMs) {
            this._setActive(false);
            return;
        }

        const pressed = (mods & CLICK_MASK) !== 0;

        if (pressed && !this._wasPressed &&
            this._config.clickEffect && !CAPTURE_TOOLS.includes(this._tool))
            this._addRipple(x, y, now);
        this._wasPressed = pressed;

        this._updateRipples(now);
        this._updateInk(now);
        this._updateHighlights(now);

        if (this._tool === 'laser') {
            this._updateLaser(x, y, mods, now);
        } else if (this._tool === 'spotlight') {
            this._spotlight.set_position(
                x - global.stage.width, y - global.stage.height
            );
        }
    }

    _addRipple(x, y, now) {
        const actor = new St.Widget({
            style: `border: 3px solid ${this._config.color}; border-radius: ${RIPPLE_SIZE}px;`,
            width: RIPPLE_SIZE,
            height: RIPPLE_SIZE,
            x: x - RIPPLE_SIZE / 2,
            y: y - RIPPLE_SIZE / 2,
            pivot_point: new imports.gi.Graphene.Point({x: 0.5, y: 0.5}),
        });

        this._overlay.add_child(actor);
        this._ripples.push({actor, time: now});
    }

    _updateRipples(now) {
        this._ripples = this._ripples.filter(({actor, time}) => {
            const progress = (now - time) / RIPPLE_DURATION_MS;

            if (progress >= 1) {
                actor.destroy();
                return false;
            }

            actor.set_scale(0.2 + 0.8 * progress, 0.2 + 0.8 * progress);
            actor.opacity = Math.round(255 * (1 - progress));
            return true;
        });
    }

    _updateHighlights(now) {
        if (this._config.highlightPersist)
            return;

        const duration = this._config.highlightDuration;

        this._highlights = this._highlights.filter(({actor, time}) => {
            const remaining = duration - (now - time);

            if (remaining <= 0) {
                actor.destroy();
                return false;
            }

            actor.opacity = Math.round(HIGHLIGHT_OPACITY * Math.min(remaining / INK_FADE_MS, 1));
            return true;
        });
    }

    _updateInk(now) {
        const duration = this._config.drawDuration;

        this._ink = this._ink.filter(({actor, time}) => {
            const remaining = duration - (now - time);

            if (remaining <= 0) {
                actor.destroy();
                return false;
            }

            actor.opacity = Math.round(255 * Math.min(remaining / INK_FADE_MS, 1));
            return true;
        });
    }

    _updateLaser(x, y, mods, now) {
        const {trailDuration, size, trailStyle} = this._config;
        const drawing = this._isLaserDrawing(mods);

        if (drawing) {
            // Relâcher la touche coupe le trait : pas de ligne entre deux gestes
            if (!this._wasDrawing)
                this._stroke++;

            const last = this._points[this._points.length - 1];

            if (!last || last.x !== x || last.y !== y)
                this._points.push({x, y, time: now, stroke: this._stroke});
        }
        this._wasDrawing = drawing;

        while (this._points.length > 0 &&
               (now - this._points[0].time > trailDuration ||
                this._points.length > MAX_POINTS))
            this._points.shift();

        this._segments.forEach((segment, i) => {
            const from = this._points[i];
            const to = this._points[i + 1];

            if (trailStyle === 'none' || !to || from.stroke !== to.stroke) {
                segment.visible = false;
                return;
            }

            const strength = Math.max(1 - (now - from.time) / trailDuration, 0);
            const width = trailStyle === 'tapered'
                ? size.trail * (0.4 + 0.6 * strength)
                : size.trail;

            this._placeStroke(segment, from, to, width);
            segment.opacity = Math.round(255 * strength);
            segment.visible = true;
        });

        this._pointer.visible = drawing;
        this._pointer.set_position(x - size.pointer / 2, y - size.pointer / 2);
    }

    disable() {
        this._setActive(false);

        this._settings.disconnect(this._settingsId);
        SHORTCUT_KEYS.forEach(key => Main.wm.removeKeybinding(key));

        this._button.destroy();
        this._button = null;
        this._toolItems = null;
        this._settings = null;
        this._notifications = null;
        this._cursorTracker = null;
    }
}

function init() {
    return new LaserPointerExtension();
}
