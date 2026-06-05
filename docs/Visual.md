# Visual.md - ioBroker-fmd-adapter

## 1. Visual Design System

This document defines the visual design language for the ioBroker-fmd-adapter, aligned with the ioBroker ecosystem.

## 2. Color Palette

### 2.1 Primary Colors

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| ioBroker Cyan | `#39c` | 51, 153, 204 | Logo, active elements, links, highlights |
| ioBroker Dark Blue | `#164477` | 22, 68, 119 | Logo border, secondary elements |

### 2.2 Neutral Colors

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Light Gray | `#ccc` | 204, 204, 204 | Scrollbar track, splitters, borders |
| Medium Gray | `#575757` | 87, 87, 87 | Scrollbar thumb, disabled states |
| Dark Gray | `#333` | 51, 51, 51 | Hover states, secondary text |
| White | `#fff` | 255, 255, 255 | Backgrounds, text on dark |
| Black | `#000` | 0, 0, 0 | Logo background |

### 2.3 Semantic Colors

| Name | Hex | Usage |
|------|-----|-------|
| Success | `#39c` (cyan) | Connection OK, ring sent |
| Warning | `#a2ff00` | Neon green - alerts |
| Error | `#d32f2f` | Standard red for errors |
| Info | `#0af` | Cyan variant - information |

### 2.4 Animation Accents

| Name | Hex | Usage |
|------|-----|-------|
| Neon Green | `#a2ff00` | Logo animation, highlights |
| Bright Cyan | `#0af` | Animation, links |

## 3. Typography

### 3.1 Font Stack

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
             Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans",
             "Helvetica Neue", sans-serif;
```

### 3.2 Headlines

| Element | Font | Weight |
|---------|------|--------|
| H1 | Terminal Dosis | 400 |
| H2 | Terminal Dosis | 400 |
| H3 | Inconsolata | 400 |

### 3.3 Body Text

| Element | Font | Size |
|---------|------|------|
| Paragraph | System sans-serif | 14-16px |
| Code | Cutive Mono / Inconsolata | 13px |
| Small | System sans-serif | 12px |

### 3.4 Line Height

- **Body text**: 1.5
- **Headlines**: 1.2
- **Code blocks**: 1.4

## 4. Spacing System

### 4.1 Base Unit

**4px** as the base unit for all spacing.

### 4.2 Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `xs` | 4px | Tight spacing, inline elements |
| `sm` | 8px | Related elements |
| `md` | 16px | Standard padding |
| `lg` | 24px | Section spacing |
| `xl` | 32px | Major sections |
| `xxl` | 48px | Page margins |

### 4.3 Component Spacing

| Component | Padding | Margin |
|-----------|---------|--------|
| Button | 8px 16px | 8px |
| Card | 16px | 16px |
| Panel | 24px | 16px |
| Form Field | 8px | 16px |

## 5. Layout System

### 5.1 Grid

- **Columns**: 12-column grid
- **Gutter**: 16px
- **Max Width**: 1536px

### 5.2 Breakpoints

| Breakpoint | Viewport | Columns |
|------------|----------|---------|
| xs | < 600px | 4 |
| sm | 600-900px | 8 |
| md | 900-1200px | 12 |
| lg | 1200-1536px | 12 |
| xl | > 1536px | 12 |

### 5.3 Responsive Spacing

| Breakpoint | Multiplier |
|------------|------------|
| xs | 0.5x |
| sm | 0.75x |
| md | 1x |
| lg | 1.25x |
| xl | 1.5x |

## 6. Admin UI Components

### 6.1 Configuration Form (jsonConfig.json5)

```json
{
    "type": "tabs",
    "i18n": true,
    "items": {
        "tabName": {
            "type": "panel",
            "label": "Tab Label",
            "items": {
                "fieldName": {
                    "type": "text",
                    "label": "Field Label",
                    "xs": 12,
                    "sm": 12,
                    "md": 6,
                    "lg": 4
                }
            }
        }
    }
}
```

### 6.2 Component Types

| Type | Purpose |
|------|---------|
| `tabs` | Tab container |
| `panel` | Tab page with items |
| `text` | Text input |
| `password` | Password input (masked) |
| `checkbox` | Boolean toggle |
| `select` | Dropdown options |
| `number` | Numeric input |
| `slider` | Range slider |
| `table` | Editable rows |
| `image` | Image upload |
| `certificate` | SSL certificates |
| `color` | Color picker |

### 6.3 Component Attributes

| Attribute | Purpose |
|-----------|---------|
| `label` | Display text (supports i18n) |
| `hidden` | Conditional visibility |
| `disabled` | Conditional editability |
| `default` | Default value |
| `validator` | Validation function |
| `help` | Help text |

## 7. Icon Guidelines

### 7.1 Adapter Icon

- **Location**: `admin/fmd.png`
- **Size**: 48x48px minimum
- **Style**: Match ioBroker visual language
- **Background**: Transparent or white

### 7.2 Status Icons

| State | Icon Suggestion |
|-------|-----------------|
| Connected | ✓ checkmark |
| Disconnected | ✗ cross |
| Error | ⚠ warning triangle |
| Ring | 🔔 bell |

## 8. README Visual Elements

### 8.1 Badge Row

```markdown
[![NPM Version](https://img.shields.io/npm/v/iobroker.fmd?style=flat-square)](https://www.npmjs.com/package/iobroker.fmd)
[![Downloads](https://img.shields.io/npm/dm/iobroker.fmd?style=flat-square)](https://www.npmjs.com/package/iobroker.fmd)
[![Test and Release](https://github.com/username/ioBroker-fmd-adapter/workflows/Test%20and%20Release/badge.svg)](https://github.com/username/ioBroker-fmd-adapter)
[![License](https://img.shields.io/github/license/username/ioBroker-fmd-adapter?style=flat-square)](LICENSE)
```

### 8.2 Code Block Styling

````markdown
```javascript
// JavaScript code here
setState('0_userdata.0.FindMyDevice.ring', 'my-phone');
```
````

### 8.3 Table Styling

Use pipes `|` and dashes `-` for markdown tables.

## 9. vis-2 Widget Styling

### 9.1 Button Widget

When creating vis-2 buttons for FMD ring:

```json
{
  "oid": "0_userdata.0.FindMyDevice.ring",
  "value": "my-phone",
  "background": "#39c",
  "color": "#fff"
}
```

### 9.2 Feedback States

| State | Background | Text |
|-------|------------|------|
| Default | `#39c` | `#fff` |
| Pressed | `#164477` | `#fff` |
| Disabled | `#ccc` | `#575757` |
| Error | `#d32f2f` | `#fff` |

## 10. Dark Mode Considerations

Currently not specifically designed, but ioBroker supports dark mode. Consider:
- Using CSS variables for colors
- Ensuring sufficient contrast ratios
- Testing in both light and dark themes

## 11. References

- [ioBroker Color Source](https://www.iobroker.net/)
- [ioBroker JSON Config](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterjsonconfig.md)
- [Shields.io](https://shields.io/) - Badge creation
