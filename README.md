# Laser Pointer

Extension GNOME Shell pour les présentations et les cours en ligne : le curseur
devient un pointeur laser, avec un projecteur, une loupe et un dessin temporaire.

## Outils

| Outil | Raccourci | Effet |
|---|---|---|
| Mode présentation | `Super+Maj+L` | Active ou quitte le mode |
| Laser | `Super+Alt+1` | Point et traînée qui s'efface, les clics passent aux applications |
| Projecteur | `Super+Alt+2` | Assombrit l'écran sauf autour du curseur |
| Loupe | `Super+Alt+3` | Agrandit l'écran autour du curseur |
| Dessin | `Super+Alt+4` | Trace à la souris, effacé après quelques secondes. `Échap` pour quitter |

Un cercle s'affiche à chaque clic, et les notifications sont coupées pendant le
mode présentation. Le tout se règle dans les paramètres de l'extension.

## Compatibilité

GNOME Shell 43 (Debian 12). Testé sur X11.

## Installation

```bash
glib-compile-schemas schemas
gnome-extensions pack --extra-source=schemas
gnome-extensions install laser-pointer@mcrai-dev.github.io.shell-extension.zip
```

Redémarrez GNOME Shell (`Alt+F2`, `r`, Entrée sur X11), puis :

```bash
gnome-extensions enable laser-pointer@mcrai-dev.github.io
```

## Licence

GPL-2.0-or-later. Copyright (C) 2026 Mcrai Laydam.
