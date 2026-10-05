// content.js - Fixed Hiding Logic (Removes ChatGPT Wrapper completely)

const viz = new Viz();
let renderTimeout;
const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');

// 1. Helper: Check for DOT format
function isDotCode(text) {
    if (!text) return false;
    const trimmed = text.trim();
    // Logic: Must start with strict/digraph/graph AND end with }
    return /^\s*(strict\s+)?(digraph|graph)\s+[\s\S]*\}\s*$/.test(trimmed);
}

// 2. Helper: Clean SVG
function styleSVG(svg) {
    const fontStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    svg.setAttribute('font-family', fontStack);
    svg.style.fontFamily = fontStack;
    
    const texts = svg.querySelectorAll('text');
    texts.forEach(text => {
        text.setAttribute('font-family', fontStack);
        text.style.fontFamily = fontStack;
        text.style.fontWeight = "400"; 
    });

    const bgPolygon = svg.querySelector('g > polygon');
    if (bgPolygon) {
        bgPolygon.setAttribute('fill', 'transparent');
        bgPolygon.setAttribute('stroke', 'transparent');
    }
}

const PAINT_UNSET = "__dot_paint_unset__";
const DARK_DIAGRAM_BACKGROUND = "#1e1e1e";
const DARK_DIAGRAM_FOREGROUND = "#d8dee9";
const LIGHT_DIAGRAM_FOREGROUND = "#24292f";
const MIN_TEXT_CONTRAST = 4.5;
let colorParserContext;
const parsedColorCache = new Map();

function originalPaintKey(prop, kind) {
    return `data-dot-original-${prop}-${kind}`;
}

function rememberOriginalPaint(element, prop) {
    const attrKey = originalPaintKey(prop, "attr");
    const styleKey = originalPaintKey(prop, "style");

    if (!element.hasAttribute(attrKey)) {
        element.setAttribute(attrKey, element.hasAttribute(prop) ? element.getAttribute(prop) : PAINT_UNSET);
    }

    if (!element.hasAttribute(styleKey)) {
        const styleValue = element.style ? element.style.getPropertyValue(prop) : "";
        element.setAttribute(styleKey, styleValue || PAINT_UNSET);
    }
}

function restoreOriginalPaint(element, prop) {
    rememberOriginalPaint(element, prop);

    const originalStyle = element.getAttribute(originalPaintKey(prop, "style"));
    if (element.style) {
        if (originalStyle === PAINT_UNSET) element.style.removeProperty(prop);
        else element.style.setProperty(prop, originalStyle);
    }

    const originalAttr = element.getAttribute(originalPaintKey(prop, "attr"));
    if (originalAttr === PAINT_UNSET) element.removeAttribute(prop);
    else element.setAttribute(prop, originalAttr);
}

function setThemedPaint(element, prop, value, important = false) {
    if (important && element.style) {
        element.style.setProperty(prop, value, "important");
        return;
    }

    const originalStyle = element.getAttribute(originalPaintKey(prop, "style"));
    if (element.style && originalStyle !== PAINT_UNSET) {
        element.style.setProperty(prop, value);
    } else {
        element.setAttribute(prop, value);
    }
}

function getPaint(element, prop) {
    const styleValue = element.style ? element.style.getPropertyValue(prop) : "";
    return styleValue || element.getAttribute(prop) || "";
}

function isTransparentPaint(value) {
    if (!value) return true;

    const normalized = value.trim().toLowerCase();
    return normalized === "none" ||
        normalized === "transparent" ||
        normalized === "rgba(0, 0, 0, 0)" ||
        normalized === "rgba(0,0,0,0)";
}

function parseHexColor(value) {
    const hex = value.slice(1);

    if (hex.length === 3 || hex.length === 4) {
        return {
            r: parseInt(hex[0] + hex[0], 16),
            g: parseInt(hex[1] + hex[1], 16),
            b: parseInt(hex[2] + hex[2], 16),
            a: hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1
        };
    }

    if (hex.length === 6 || hex.length === 8) {
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16),
            a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
        };
    }

    return null;
}

function parseRgbColor(value) {
    const match = value.match(/^rgba?\((.+)\)$/);
    if (!match) return null;

    const parts = match[1].split(",").map(part => part.trim());
    if (parts.length < 3) return null;

    return {
        r: Number.parseFloat(parts[0]),
        g: Number.parseFloat(parts[1]),
        b: Number.parseFloat(parts[2]),
        a: parts.length >= 4 ? Number.parseFloat(parts[3]) : 1
    };
}

function parseColor(value) {
    if (!value) return null;

    const normalized = value.trim().toLowerCase();
    if (isTransparentPaint(normalized) || normalized === "currentcolor" || normalized.startsWith("url(")) return null;
    if (parsedColorCache.has(normalized)) return parsedColorCache.get(normalized);

    let parsed = null;
    if (normalized.startsWith("#")) {
        parsed = parseHexColor(normalized);
    } else if (normalized.startsWith("rgb")) {
        parsed = parseRgbColor(normalized);
    } else if (!window.CSS || window.CSS.supports("color", normalized)) {
        colorParserContext ||= document.createElement("canvas").getContext("2d");
        colorParserContext.fillStyle = "#000000";
        colorParserContext.fillStyle = normalized;
        const serialized = colorParserContext.fillStyle;
        parsed = serialized.startsWith("#") ? parseHexColor(serialized) : parseRgbColor(serialized);
    }

    parsedColorCache.set(normalized, parsed);
    return parsed;
}

function luminance(color) {
    const channels = [color.r, color.g, color.b].map(channel => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });

    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(firstLuminance, secondLuminance) {
    const lighter = Math.max(firstLuminance, secondLuminance);
    const darker = Math.min(firstLuminance, secondLuminance);
    return (lighter + 0.05) / (darker + 0.05);
}

function clampColorChannel(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function colorToHex(color) {
    const toHex = channel => clampColorChannel(channel).toString(16).padStart(2, "0");
    return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function rgbToHsl(color) {
    const r = color.r / 255;
    const g = color.g / 255;
    const b = color.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const delta = max - min;
        s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

        if (max === r) h = (g - b) / delta + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;

        h /= 6;
    }

    return { h, s, l };
}

function hueToRgb(p, q, t) {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
}

function hslToRgb(hsl) {
    const { h, s, l } = hsl;
    let r;
    let g;
    let b;

    if (s === 0) {
        r = l;
        g = l;
        b = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hueToRgb(p, q, h + 1 / 3);
        g = hueToRgb(p, q, h);
        b = hueToRgb(p, q, h - 1 / 3);
    }

    return { r: r * 255, g: g * 255, b: b * 255, a: 1 };
}

function isNeutralDarkPaint(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "currentcolor") return true;

    const color = parseColor(normalized);
    return Boolean(color && color.a !== 0 && color.r <= 24 && color.g <= 24 && color.b <= 24);
}

function getElementFillLuminance(element) {
    const fill = getPaint(element, "fill");
    if (isTransparentPaint(fill)) return null;

    const color = parseColor(fill);
    return color && color.a !== 0 ? luminance(color) : null;
}

function getTextBackdropLuminance(text) {
    // FIX: Ignore edge groups because edge text floats over the main dark/light canvas,
    // not over the actual line or arrowhead polygon inside the edge group.
    if (text.closest("g.edge")) {
        return null; 
    }

    const group = text.closest("g");
    if (!group) return null;

    const shapes = Array.from(group.querySelectorAll("ellipse, polygon, path, rect"));
    for (const shape of shapes) {
        const fillLuminance = getElementFillLuminance(shape);
        if (fillLuminance !== null) return fillLuminance;
    }

    return null;
}

function readableTextColor(text, isDark) {
    const backdropLuminance = getTextBackdropLuminance(text);

    if (backdropLuminance !== null) {
        return backdropLuminance > 0.45 ? "#111827" : "#f6f8fa";
    }

    return isDark ? DARK_DIAGRAM_FOREGROUND : LIGHT_DIAGRAM_FOREGROUND;
}

function boostColorContrast(color, targetLuminance, preferLightText) {
    const hsl = rgbToHsl(color);

    if (hsl.s < 0.08) {
        return preferLightText ? "#f6f8fa" : "#111827";
    }

    const originalLightness = hsl.l;
    const targetLightness = preferLightText ? 0.86 : 0.18;

    for (let step = 0; step <= 100; step++) {
        const progress = step / 100;
        const adjusted = {
            h: hsl.h,
            s: Math.max(hsl.s, 0.55),
            l: originalLightness + ((targetLightness - originalLightness) * progress)
        };
        const candidate = hslToRgb(adjusted);

        if (contrastRatio(luminance(candidate), targetLuminance) >= MIN_TEXT_CONTRAST) {
            return colorToHex(candidate);
        }
    }

    return preferLightText ? "#f6f8fa" : "#111827";
}

function readableExplicitTextColor(text, fill) {
    const color = parseColor(fill);
    if (!color || color.a === 0) return null;

    const textLuminance = luminance(color);
    const backdropLuminance = getTextBackdropLuminance(text);
    const targetLuminance = backdropLuminance ?? luminance(parseColor(DARK_DIAGRAM_BACKGROUND));

    if (contrastRatio(textLuminance, targetLuminance) >= MIN_TEXT_CONTRAST) return null;

    return boostColorContrast(color, targetLuminance, targetLuminance <= 0.45);
}

function getSvgThemeStyle(svg) {
    const existingStyle = Array.from(svg.children).find(child => {
        return child.getAttribute("data-dot-theme-style") === "true";
    });

    if (existingStyle) return existingStyle;

    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.setAttribute("data-dot-theme-style", "true");
    svg.insertBefore(style, svg.firstChild);
    return style;
}

function applySvgTextStylesheet(svg, isDark) {
    const style = getSvgThemeStyle(svg);

    style.textContent = isDark ? `
        text, tspan, textPath {
            fill: ${DARK_DIAGRAM_FOREGROUND} !important;
            color: ${DARK_DIAGRAM_FOREGROUND} !important;
        }

        g.edge text, g.edge tspan, g.edge textPath {
            fill: #f6f8fa !important;
            color: #f6f8fa !important;
        }
    ` : "";
}

function forceReadableSvgText(svg, isDark) {
    if (!isDark) return;

    svg.querySelectorAll("text, tspan, textPath").forEach(text => {
        const fill = getPaint(text, "fill");
        let textColor;

        if (!isTransparentPaint(fill) && !isNeutralDarkPaint(fill)) {
            textColor = readableExplicitTextColor(text, fill) || fill;
        } else {
            textColor = readableTextColor(text, isDark);
        }

        setThemedPaint(text, "fill", textColor, true);
        text.style.setProperty("color", textColor, "important");
    });
}

function shouldThemeStroke(element) {
    if (element.closest("g.edge")) return true;

    const fill = getPaint(element, "fill");
    if (isTransparentPaint(fill)) return true;

    const fillColor = parseColor(fill);
    return Boolean(fillColor && fillColor.a !== 0 && luminance(fillColor) <= 0.45);
}

function applySvgTheme(svg, isDark) {
    const elements = Array.from(svg.querySelectorAll("*"));

    [...elements, svg].forEach(element => {
        ["fill", "stroke", "color"].forEach(prop => restoreOriginalPaint(element, prop));
    });

    svg.style.color = isDark ? DARK_DIAGRAM_FOREGROUND : LIGHT_DIAGRAM_FOREGROUND;
    svg.style.filter = isDark
        ? "drop-shadow(0 1px 2px rgba(0,0,0,0.35))"
        : "drop-shadow(0 1px 2px rgba(0,0,0,0.1))";
    applySvgTextStylesheet(svg, isDark);

    if (!isDark) return;

    elements.forEach(element => {
        const tag = element.tagName.toLowerCase();
        const fill = getPaint(element, "fill");
        const stroke = getPaint(element, "stroke");

        if (tag === "text" && (isTransparentPaint(fill) || isNeutralDarkPaint(fill))) {
            setThemedPaint(element, "fill", readableTextColor(element, isDark), true);
        } else if (tag === "text") {
            const boostedFill = readableExplicitTextColor(element, fill);
            setThemedPaint(element, "fill", boostedFill || fill || readableTextColor(element, isDark), true);
        } else if (element.closest("g.edge") && !isTransparentPaint(fill) && isNeutralDarkPaint(fill)) {
            setThemedPaint(element, "fill", DARK_DIAGRAM_FOREGROUND);
        }

        if (!isTransparentPaint(stroke) && isNeutralDarkPaint(stroke) && shouldThemeStroke(element)) {
            setThemedPaint(element, "stroke", DARK_DIAGRAM_FOREGROUND);
        }
    });

    forceReadableSvgText(svg, isDark);
}

// 3. Central Logic: Apply Theme
function applyTheme(wrapper, isDark) {
    const svg = wrapper.querySelector('svg');
    const buttons = wrapper.querySelectorAll('.dot-btn');

    wrapper.dataset.theme = isDark ? "dark" : "light";

    if (isDark) {
        // DARK MODE
        wrapper.style.backgroundColor = "#1e1e1e"; 
        wrapper.style.borderColor = "#333";
        wrapper.style.color = "#ccc";

        if (svg) applySvgTheme(svg, true);

        buttons.forEach(btn => {
            btn.style.backgroundColor = "rgba(255, 255, 255, 0.08)";
            btn.style.color = "#eee";
            btn.onmouseover = () => btn.style.backgroundColor = "rgba(255, 255, 255, 0.15)";
            btn.onmouseout = () => btn.style.backgroundColor = "rgba(255, 255, 255, 0.08)";
        });
    } else {
        // LIGHT MODE
        wrapper.style.backgroundColor = "#ffffff";
        wrapper.style.borderColor = "#eaeaea";
        wrapper.style.color = "#444";

        if (svg) applySvgTheme(svg, false);

        buttons.forEach(btn => {
            btn.style.backgroundColor = "rgba(0, 0, 0, 0.04)";
            btn.style.color = "#333";
            btn.onmouseover = () => btn.style.backgroundColor = "rgba(0, 0, 0, 0.08)";
            btn.onmouseout = () => btn.style.backgroundColor = "rgba(0, 0, 0, 0.04)";
        });
    }
}

// 4. Create Toolbar
function createToolbar(container, wrapper, originalDisplay) {
    const toolbar = document.createElement('div');
    toolbar.style.position = "absolute";
    toolbar.style.top = "12px";
    toolbar.style.right = "12px";
    toolbar.style.display = "flex";
    toolbar.style.gap = "8px";
    toolbar.style.zIndex = "10";
    toolbar.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    const initBtn = (btn) => {
        btn.classList.add('dot-btn');
        btn.style.cursor = "pointer";
        btn.style.border = "none";
        btn.style.padding = "6px 12px";
        btn.style.borderRadius = "20px";
        btn.style.fontSize = "12px";
        btn.style.fontWeight = "600";
        btn.style.transition = "all 0.2s ease";
        btn.style.backdropFilter = "blur(4px)";
        btn.style.display = "flex";
        btn.style.alignItems = "center";
        btn.style.gap = "5px";
    };

    const btnCode = document.createElement('button');
    btnCode.innerHTML = "<span>Code</span>";
    initBtn(btnCode);
    btnCode.onclick = () => {
        const svgContainer = wrapper.querySelector('.dot-svg-container');
        if (container.style.display === "none") {
            // SHOW CODE: Restore the container and hide diagram
            container.style.removeProperty('display'); // Cleanest way to restore
            svgContainer.style.display = "none";
            btnCode.innerHTML = "<span>Diagram</span>";
        } else {
            // HIDE CODE: Force hide container and show diagram
            container.style.setProperty('display', 'none', 'important');
            svgContainer.style.display = "flex";
            btnCode.innerHTML = "<span>Code</span>";
        }
    };

    const btnTheme = document.createElement('button');
    btnTheme.innerHTML = "<span>Theme</span>";
    initBtn(btnTheme);
    btnTheme.onclick = () => {
        const currentTheme = wrapper.dataset.theme;
        applyTheme(wrapper, currentTheme === "light"); 
    };

    toolbar.appendChild(btnTheme);
    toolbar.appendChild(btnCode);
    return toolbar;
}

// 5. Main Processing Logic
function processPage() {
    const currentSystemDark = themeQuery.matches;
    const standardBlocks = document.querySelectorAll('pre code, div.code-block code');
    standardBlocks.forEach(el => tryProcessBlock(el, 'standard', currentSystemDark));
    const cmBlocks = document.querySelectorAll('.cm-content');
    cmBlocks.forEach(el => tryProcessBlock(el, 'codemirror', currentSystemDark));
}

function tryProcessBlock(element, type, systemDark) {
    let dotCode = "";
    let container = null;

    if (type === 'standard') {
        dotCode = element.innerText;
        container = element.closest('pre') || element.parentElement;
    } 
    else if (type === 'codemirror') {
        // Get Code
        const lines = element.querySelectorAll('.cm-line');
        if (lines.length > 0) {
            dotCode = Array.from(lines).map(line => line.textContent).join('\n');
        } else {
            dotCode = element.innerText; 
        }

        // FIND THE TRUE CONTAINER
        // We look for the "border-token" class which represents the outer box in ChatGPT
        const editor = element.closest('.cm-editor');
        if (editor) {
            // Walk up to find the main card wrapper
            container = editor.closest('[class*="border-token-border"]') || 
                        editor.closest('[class*="rounded-3xl"]') || 
                        editor; // Fallback to editor if structure changes
        }
    }

    // Validate
    if (!container || !isDotCode(dotCode)) return;

    // Wrapper Setup
    let wrapper = container.nextElementSibling;
    if (!wrapper || !wrapper.classList.contains('dot-diagram-wrapper')) {
        wrapper = document.createElement('div');
        wrapper.classList.add('dot-diagram-wrapper');
        
        // Styles
        wrapper.style.position = "relative"; 
        wrapper.style.borderRadius = "12px"; 
        wrapper.style.marginTop = "16px";
        wrapper.style.marginBottom = "16px";
        wrapper.style.padding = "30px 20px";
        wrapper.style.border = "1px solid transparent";
        wrapper.style.maxWidth = "100%";
        wrapper.style.overflow = "hidden";
        wrapper.style.transition = "background-color 0.3s ease, border-color 0.3s ease"; 

        const originalDisplay = window.getComputedStyle(container).display;
        wrapper.appendChild(createToolbar(container, wrapper, originalDisplay));

        const svgContainer = document.createElement('div');
        svgContainer.classList.add('dot-svg-container');
        svgContainer.style.display = "flex";
        svgContainer.style.justifyContent = "center";
        svgContainer.style.overflowX = "auto";
        svgContainer.innerHTML = "<em style='font-family:sans-serif; opacity:0.6;'>Generating...</em>";
        
        wrapper.appendChild(svgContainer);
        container.parentNode.insertBefore(wrapper, container.nextSibling);
        
        // --- KEY FIX: FORCE HIDE ---
        // We use setProperty with !important to ensure React doesn't override it
        container.style.setProperty('display', 'none', 'important');

        applyTheme(wrapper, systemDark);
    }

    if (wrapper.dataset.lastRendered === dotCode) return;

    viz.renderSVGElement(dotCode)
        .then(svg => {
            const svgContainer = wrapper.querySelector('.dot-svg-container');
            svgContainer.innerHTML = ''; 
            svg.style.maxWidth = "100%";
            svg.style.height = "auto";
            styleSVG(svg);
            
            const isDark = wrapper.dataset.theme === "dark";
            applySvgTheme(svg, isDark);

            svgContainer.appendChild(svg);
            wrapper.dataset.lastRendered = dotCode;
        })
        .catch(err => {});
}

themeQuery.addEventListener('change', (e) => {
    document.querySelectorAll('.dot-diagram-wrapper').forEach(wrapper => {
        applyTheme(wrapper, e.matches);
    });
});

const observer = new MutationObserver(() => {
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(processPage, 500);
});

observer.observe(document.body, { childList: true, subtree: true, characterData: true });


