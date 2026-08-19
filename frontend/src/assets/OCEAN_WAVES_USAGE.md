# Ocean Waves Background - Usage Guide

## Overview
A vibrant, minimal ocean wave SVG background designed to match the VNU TOUR 2026 branding. The design features layered waves with fresh, energetic colors (blues, cyans, teals) and maintains excellent readability for text and logos.

## Features
✅ Flat vector design with smooth, flowing curves
✅ Multiple wave layers for depth and movement
✅ Bright sky gradient with optional subtle clouds and sun
✅ Responsive SVG (scales to any screen size)
✅ Color palette: blues, cyans, teals with accent oranges/yellows
✅ Minimal, clean aesthetic - no boats, people, or clutter

## Color Palette Used
- Sky: `#E6F7FF` to `#B3E5FC`
- Bright Cyan: `#39D5F4`, `#00B6F1`
- Ocean Blue: `#1478D4`
- Teal Green: `#18C2A3`
- Accents: `#FFD54D`, `#FF8A00`, `#7BC043`

## Files
- **SVG**: `/src/assets/ocean-waves-bg.svg` - The main background graphic
- **CSS**: Styles added to `/src/index.css`

## Usage Methods

### Method 1: As a Hero Section Background (Recommended)
```jsx
import './index.css';

export function HeroSection() {
  return (
    <div className="ocean-wave-hero">
      <div className="content-above-waves">
        <h1>Welcome to VNU TOUR 2026</h1>
        <p>Discover amazing adventures</p>
      </div>
    </div>
  );
}
```

### Method 2: As a Full Page Background
```jsx
export function App() {
  return (
    <div className="ocean-waves-background min-h-screen">
      {/* Your content here */}
    </div>
  );
}
```

### Method 3: In CSS or Tailwind
```css
/* Add to your CSS */
.my-hero {
  background-image: url('/src/assets/ocean-waves-bg.svg');
  background-size: cover;
  background-position: center bottom;
  background-repeat: no-repeat;
}
```

### Method 4: With Animation
```jsx
<div className="ocean-wave-hero">
  <div className="content-above-waves wave-animated">
    {/* Your animated content */}
  </div>
</div>
```

## CSS Classes Available

| Class | Purpose |
|-------|---------|
| `.ocean-waves-background` | Apply SVG background to any element |
| `.ocean-wave-hero` | Full hero section with gradient + SVG waves |
| `.content-above-waves` | Ensure content appears above waves (z-index: 10) |
| `.wave-animated` | Add bobbing animation to elements |
| `.animate-wave-float` | Wave drift animation (6s) |
| `.animate-cloud` | Cloud movement animation (12s) |

## Customization

### Change Wave Colors
Edit `/src/assets/ocean-waves-bg.svg` and modify the gradient definitions:
```xml
<stop offset="0%" style="stop-color:#39D5F4;stop-opacity:1" />
<stop offset="100%" style="stop-color:#00B6F1;stop-opacity:1" />
```

### Adjust Wave Height
Modify the SVG `viewBox` or path `d` attributes to increase/decrease wave height.

### Add More Layers
Duplicate wave `<path>` elements and adjust the `d` attribute for different wave patterns.

### Change Opacity
Adjust the `opacity` attribute on wave layers (currently 0.7 - 1.0).

## Design Notes
- The background works with both light and dark text
- Waves occupy the lower 60% of the space, leaving room for content
- The flat vector style ensures it scales perfectly on all devices
- Uses SVG for crisp rendering at any size
- Subtle shadows on waves add depth without overwhelming

## Integration Tips
1. Use `.content-above-waves` class on your main content container
2. Set text color to `#0c1d33` (navy) for best contrast
3. Keep text within the upper 40% of the screen for optimal readability
4. For dark text on light background, the sky gradient provides excellent contrast

## Browser Support
- All modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile browsers (iOS Safari, Chrome Mobile)
- Responsive design scales automatically

---
**Asset Location**: `frontend/src/assets/ocean-waves-bg.svg`
**CSS Location**: `frontend/src/index.css` (styles added)
**Created**: August 2026
**Style**: Flat Vector, Minimal, Vibrant
