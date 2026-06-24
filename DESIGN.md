---
name: Stellar Whisper
colors:
  surface: '#10131a'
  surface-dim: '#10131a'
  surface-bright: '#363940'
  surface-container-lowest: '#0b0e14'
  surface-container-low: '#191c22'
  surface-container: '#1d2026'
  surface-container-high: '#272a31'
  surface-container-highest: '#32353c'
  on-surface: '#e1e2eb'
  on-surface-variant: '#cfc2d7'
  inverse-surface: '#e1e2eb'
  inverse-on-surface: '#2e3037'
  outline: '#988ca0'
  outline-variant: '#4c4354'
  surface-tint: '#dcb8ff'
  primary: '#dcb8ff'
  on-primary: '#480081'
  primary-container: '#8a2be2'
  on-primary-container: '#eed9ff'
  inverse-primary: '#8422dc'
  secondary: '#e6feff'
  on-secondary: '#003739'
  secondary-container: '#00f4fe'
  on-secondary-container: '#006c71'
  tertiary: '#fface8'
  on-tertiary: '#5e0053'
  tertiary-container: '#b600a3'
  on-tertiary-container: '#ffd5f0'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#efdbff'
  primary-fixed-dim: '#dcb8ff'
  on-primary-fixed: '#2c0051'
  on-primary-fixed-variant: '#6700b5'
  secondary-fixed: '#63f7ff'
  secondary-fixed-dim: '#00dce5'
  on-secondary-fixed: '#002021'
  on-secondary-fixed-variant: '#004f53'
  tertiary-fixed: '#ffd7f0'
  tertiary-fixed-dim: '#fface8'
  on-tertiary-fixed: '#3a0033'
  on-tertiary-fixed-variant: '#840076'
  background: '#10131a'
  on-background: '#e1e2eb'
  surface-variant: '#32353c'
typography:
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Space Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Space Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.1em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-max: 1200px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 40px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style

The design system embodies a "Celestial Fintech" aesthetic, merging the vast, secure silence of deep space with the high-velocity precision of the Stellar network. It targets a privacy-conscious audience that values both cutting-edge security and a premium, futuristic experience. 

The visual style is **Glassmorphism**. Interfaces should feel like advanced holographic HUDs floating in a cosmic void. This is achieved through layered translucency, high-performance background blurs, and "light-leak" accents that simulate distant starlight. The emotional response should be one of "Secure Serenity"—the user feels protected by advanced technology that remains ethereal and unobtrusive.

## Colors

The palette is anchored in a deep **Obsidian Black (#0B0E14)** to provide maximum contrast for glass effects. 

- **Primary (Stellar Purple):** Used for core brand moments, primary actions, and security-related indicators.
- **Secondary (Cyber Cyan):** Used for transaction status, success states, and interactive accents to provide a "high-tech" flicker.
- **Tertiary (Nebula Magenta):** Reserved for ultra-private features or special "whisper" transaction modes.
- **Glass Surfaces:** All containers utilize a base translucency of `rgba(255, 255, 255, 0.05)` with a `backdrop-filter: blur(12px)`.

## Typography

This design system uses a multi-layered typographic approach to balance modern fintech with technical precision. 

- **Headlines:** Plus Jakarta Sans provides a friendly yet geometric authority. Use tight letter-spacing for large headlines to create a "premium magazine" feel.
- **Body:** Inter ensures maximum legibility over dark, blurred backgrounds. 
- **Labels & Data:** Space Mono is used for wallet addresses, transaction hashes, and technical metadata, reinforcing the "high-tech/coder" aspect of private remittances.

All text appearing on glass surfaces should have a slight `text-shadow: 0 2px 4px rgba(0,0,0,0.3)` to maintain readability against shifting background blurs.

## Layout & Spacing

The layout philosophy follows a **Fluid Glass Grid**. Containers should feel like they are floating; therefore, use generous margins to prevent glass edges from touching the screen boundary.

- **Desktop:** 12-column grid with 24px gutters. Content is centered with a max-width of 1200px.
- **Mobile:** Single column with 16px side margins.
- **Rhythm:** Use an 8px base unit for all internal component spacing.
- **Layering:** Vertical spacing between glass cards should be at least 16px to allow the "ethereal" background to be visible between elements.

## Elevation & Depth

Depth is not communicated through traditional drop shadows, but through **Tonal Opacity** and **Backdrop Blurs**.

1.  **Level 0 (Deepest):** Background cosmos gradient.
2.  **Level 1 (Surface):** Main UI containers. `backdrop-filter: blur(10px)`; `background: rgba(255, 255, 255, 0.03)`.
3.  **Level 2 (Elevated):** Modals or active cards. `backdrop-filter: blur(20px)`; `background: rgba(255, 255, 255, 0.08)`.
4.  **Level 3 (Overlay):** Tooltips and dropdowns. Solid `0.8` opacity to ensure focus.

All glass elements must feature a **1px Inner Stroke** using a linear gradient (top-left to bottom-right) from `white (alpha 0.2)` to `white (alpha 0.05)`. This simulates the "edge" of a glass pane catching a distant light source.

## Shapes

The design system utilizes **Rounded (2)** corners to maintain a sophisticated yet approachable silhouette. 

- **Primary Cards:** 1rem (16px) corner radius.
- **Buttons/Inputs:** 0.5rem (8px) corner radius.
- **Status Pills:** Fully rounded (Pill-shaped) to distinguish them from actionable buttons.

Avoid sharp 0px corners, as they feel too "industrial" for the fluid, celestial theme.

## Components

### Buttons
- **Primary:** High-gloss Cyber Cyan gradient. Use `box-shadow: 0 0 20px rgba(0, 245, 255, 0.3)` to create a subtle neon glow.
- **Glass Action:** Transparent background, 1px white border, heavy backdrop blur. On hover, increase opacity to `0.15`.

### Status Indicators (Shielded)
- **Privacy Pulse:** A circular indicator for "Shielded" status. It should feature a secondary glow animation—a breathing scale effect from 0.8 to 1.2 opacity using the Primary Purple.

### Input Fields
- **Glass Inputs:** `rgba(255, 255, 255, 0.05)` fill. The border should transition from the standard glass stroke to a solid Cyber Cyan stroke upon focus.

### Glass Cards
- All cards must have the 1px gradient stroke. 
- For "Featured" cards (like account balance), add a very subtle radial gradient highlight in the top-right corner using `rgba(138, 43, 226, 0.15)`.

### Lists
- Use "Separated Rows" instead of a continuous list. Each list item is its own glass sliver with 8px of vertical breathing room between items.