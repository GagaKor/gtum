import React from 'react'
import { createRoot } from 'react-dom/client'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  createProjectRuntimeService,
  hasTauriRuntime,
} from './shared/api/runtimeProjects'
import {
  createRuntimeWindowControls,
  initialRuntimeWindowControls,
} from './shared/api/runtimeWindow'
import {
  CODEX_LOGIN_COMMAND,
  CODEX_REQUIRED_SCOPES,
  createAgentAuthRuntimeService,
  providerViewStateFromConnection,
} from './shared/api/runtimeAgentAuth'
import { createAgentSuggestionRuntimeService } from './shared/api/runtimeAgentSuggestions'
import { createTerminalRuntimeService } from './shared/api/runtimeTerminals'
import { StatusBar } from './widgets/app-shell/ui/StatusBar'
import { Titlebar } from './widgets/app-shell/ui/Titlebar'
import { initialOs, detectRuntimeOs } from './shared/lib/os/detectOs'
import './styles.css'

const ReactDOM = { createRoot }

// ----- tweaks-panel.jsx -----

// tweaks-panel.jsx
// Reusable Tweaks shell + form-control helpers.
//
// Owns the host protocol (listens for __activate_edit_mode / __deactivate_edit_mode,
// posts __edit_mode_available / __edit_mode_set_keys / __edit_mode_dismissed) so
// individual prototypes don't re-roll it. Ships a consistent set of controls so you
// don't hand-draw <input type="range">, segmented radios, steppers, etc.
//
// Usage (in an HTML file that loads React + Babel):
//
//   const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
//     "primaryColor": "#D97757",
//     "palette": ["#D97757", "#29261b", "#f6f4ef"],
//     "fontSize": 16,
//     "density": "regular",
//     "dark": false
//   }/*EDITMODE-END*/;
//
//   function App() {
//     const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
//     return (
//       <div style={{ fontSize: t.fontSize, color: t.primaryColor }}>
//         Hello
//         <TweaksPanel>
//           <TweakSection label="Typography" />
//           <TweakSlider label="Font size" value={t.fontSize} min={10} max={32} unit="px"
//                        onChange={(v) => setTweak('fontSize', v)} />
//           <TweakRadio  label="Density" value={t.density}
//                        options={['compact', 'regular', 'comfy']}
//                        onChange={(v) => setTweak('density', v)} />
//           <TweakSection label="Theme" />
//           <TweakColor  label="Primary" value={t.primaryColor}
//                        options={['#D97757', '#2A6FDB', '#1F8A5B', '#7A5AE0']}
//                        onChange={(v) => setTweak('primaryColor', v)} />
//           <TweakColor  label="Palette" value={t.palette}
//                        options={[['#D97757', '#29261b', '#f6f4ef'],
//                                  ['#475569', '#0f172a', '#f1f5f9']]}
//                        onChange={(v) => setTweak('palette', v)} />
//           <TweakToggle label="Dark mode" value={t.dark}
//                        onChange={(v) => setTweak('dark', v)} />
//         </TweaksPanel>
//       </div>
//     );
//   }
//
// ─────────────────────────────────────────────────────────────────────────────

const __TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    transform:scale(var(--dc-inv-zoom,1));transform-origin:bottom right;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:default;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.25);
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}

  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}

  .twk-field{appearance:none;box-sizing:border-box;width:100%;min-width:0;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  .twk-field:focus{border-color:rgba(0,0,0,.25);background:rgba(255,255,255,.85)}
  select.twk-field{padding-right:22px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
    background-repeat:no-repeat;background-position:right 8px center}

  .twk-slider{appearance:none;-webkit-appearance:none;width:100%;height:4px;margin:6px 0;
    border-radius:999px;background:rgba(0,0,0,.12);outline:none}
  .twk-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
    width:14px;height:14px;border-radius:50%;background:#fff;
    border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}
  .twk-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
    background:#fff;border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}

  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg.dragging .twk-seg-thumb{transition:none}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:default;padding:4px 6px;line-height:1.2;
    overflow-wrap:anywhere}

  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:default;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}

  .twk-num{display:flex;align-items:center;box-sizing:border-box;min-width:0;height:26px;padding:0 0 0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;background:rgba(255,255,255,.6)}
  .twk-num-lbl{font-weight:500;color:rgba(41,38,27,.6);cursor:ew-resize;
    user-select:none;padding-right:8px}
  .twk-num input{flex:1;min-width:0;height:100%;border:0;background:transparent;
    font:inherit;font-variant-numeric:tabular-nums;text-align:right;padding:0 8px 0 0;
    outline:none;color:inherit;-moz-appearance:textfield}
  .twk-num input::-webkit-inner-spin-button,.twk-num input::-webkit-outer-spin-button{
    -webkit-appearance:none;margin:0}
  .twk-num-unit{padding-right:8px;color:rgba(41,38,27,.45)}

  .twk-btn{appearance:none;height:26px;padding:0 12px;border:0;border-radius:7px;
    background:rgba(0,0,0,.78);color:#fff;font:inherit;font-weight:500;cursor:default}
  .twk-btn:hover{background:rgba(0,0,0,.88)}
  .twk-btn.secondary{background:rgba(0,0,0,.06);color:inherit}
  .twk-btn.secondary:hover{background:rgba(0,0,0,.1)}

  .twk-swatch{appearance:none;-webkit-appearance:none;width:56px;height:22px;
    border:.5px solid rgba(0,0,0,.1);border-radius:6px;padding:0;cursor:default;
    background:transparent;flex-shrink:0}
  .twk-swatch::-webkit-color-swatch-wrapper{padding:0}
  .twk-swatch::-webkit-color-swatch{border:0;border-radius:5.5px}
  .twk-swatch::-moz-color-swatch{border:0;border-radius:5.5px}

  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:46px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:default;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s cubic-bezier(.3,.7,.4,1),box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px);
    box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.12)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),
    0 2px 6px rgba(0,0,0,.15)}
  .twk-chip>span{position:absolute;top:0;bottom:0;right:0;width:34%;
    display:flex;flex-direction:column;box-shadow:-1px 0 0 rgba(0,0,0,.1)}
  .twk-chip>span>i{flex:1;box-shadow:0 -1px 0 rgba(0,0,0,.1)}
  .twk-chip>span>i:first-child{box-shadow:none}
  .twk-chip svg{position:absolute;top:6px;left:6px;width:13px;height:13px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}
`;

// ── useTweaks ───────────────────────────────────────────────────────────────
// Single source of truth for tweak values. setTweak persists via the host
// (__edit_mode_set_keys → host rewrites the EDITMODE block on disk).
function useTweaks(defaults) {
  const [values, setValues] = React.useState(defaults);
  // Accepts either setTweak('key', value) or setTweak({ key: value, ... }) so a
  // useState-style call doesn't write a "[object Object]" key into the persisted
  // JSON block.
  const setTweak = React.useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null
      ? keyOrEdits : { [keyOrEdits]: val };
    setValues((prev) => ({ ...prev, ...edits }));
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*');
    // Same-window signal so in-page listeners (deck-stage rail thumbnails)
    // can react — the parent message only reaches the host, not peers.
    window.dispatchEvent(new CustomEvent('tweakchange', { detail: edits }));
  }, []);
  return [values, setTweak];
}

// ── TweaksPanel ─────────────────────────────────────────────────────────────
// Floating shell. Registers the protocol listener BEFORE announcing
// availability — if the announce ran first, the host's activate could land
// before our handler exists and the toolbar toggle would silently no-op.
// The close button posts __edit_mode_dismissed so the host's toolbar toggle
// flips off in lockstep; the host echoes __deactivate_edit_mode back which
// is what actually hides the panel.
function TweaksPanel({ title = 'Tweaks', children }) {
  const [open, setOpen] = React.useState(false);
  const dragRef = React.useRef(null);
  const offsetRef = React.useRef({ x: 16, y: 16 });
  const PAD = 16;

  const clampToViewport = React.useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y)),
    };
    panel.style.right = offsetRef.current.x + 'px';
    panel.style.bottom = offsetRef.current.y + 'px';
  }, []);

  React.useEffect(() => {
    if (!open) return;
    clampToViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', clampToViewport);
      return () => window.removeEventListener('resize', clampToViewport);
    }
    const ro = new ResizeObserver(clampToViewport);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open, clampToViewport]);

  React.useEffect(() => {
    const onMsg = (e) => {
      const t = e?.data?.type;
      if (t === '__activate_edit_mode') setOpen(true);
      else if (t === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const dismiss = () => {
    setOpen(false);
    window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*');
  };

  const onDragStart = (e) => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev) => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy),
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!open) return null;
  return (
    <>
      <style>{__TWEAKS_STYLE}</style>
      <div ref={dragRef} className="twk-panel" data-omelette-chrome=""
           style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}>
        <div className="twk-hd" onMouseDown={onDragStart}>
          <b>{title}</b>
          <button className="twk-x" aria-label="Close tweaks"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={dismiss}>✕</button>
        </div>
        <div className="twk-body">
          {children}
        </div>
      </div>
    </>
  );
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function TweakSection({ label, children }) {
  return (
    <>
      <div className="twk-sect">{label}</div>
      {children}
    </>
  );
}

function TweakRow({ label, value, children, inline = false }) {
  return (
    <div className={inline ? 'twk-row twk-row-h' : 'twk-row'}>
      <div className="twk-lbl">
        <span>{label}</span>
        {value != null && <span className="twk-val">{value}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Controls ────────────────────────────────────────────────────────────────

function TweakSlider({ label, value, min = 0, max = 100, step = 1, unit = '', onChange }) {
  return (
    <TweakRow label={label} value={`${value}${unit}`}>
      <input type="range" className="twk-slider" min={min} max={max} step={step}
             value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </TweakRow>
  );
}

function TweakToggle({ label, value, onChange }) {
  return (
    <div className="twk-row twk-row-h">
      <div className="twk-lbl"><span>{label}</span></div>
      <button type="button" className="twk-toggle" data-on={value ? '1' : '0'}
              role="switch" aria-checked={!!value}
              onClick={() => onChange(!value)}><i /></button>
    </div>
  );
}

function TweakRadio({ label, value, options, onChange }) {
  const trackRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);
  // The active value is read by pointer-move handlers attached for the lifetime
  // of a drag — ref it so a stale closure doesn't fire onChange for every move.
  const valueRef = React.useRef(value);
  valueRef.current = value;

  // Segments wrap mid-word once per-segment width runs out. The track is
  // ~248px (280 panel − 28 body pad − 4 seg pad), each button loses 12px
  // to its own padding, and 11.5px system-ui averages ~6.3px/char — so 2
  // options fit ~16 chars each, 3 fit ~10. Past that (or >3 options), fall
  // back to a dropdown rather than wrap.
  const labelLen = (o) => String(typeof o === 'object' ? o.label : o).length;
  const maxLen = options.reduce((m, o) => Math.max(m, labelLen(o)), 0);
  const fitsAsSegments = maxLen <= ({ 2: 16, 3: 10 }[options.length] ?? 0);
  if (!fitsAsSegments) {
    // <select> emits strings — map back to the original option value so the
    // fallback stays type-preserving (numbers, booleans) like the segment path.
    const resolve = (s) => {
      const m = options.find((o) => String(typeof o === 'object' ? o.value : o) === s);
      return m === undefined ? s : typeof m === 'object' ? m.value : m;
    };
    return <TweakSelect label={label} value={value} options={options}
                        onChange={(s) => onChange(resolve(s))} />;
  }
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  const idx = Math.max(0, opts.findIndex((o) => o.value === value));
  const n = opts.length;

  const segAt = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor(((clientX - r.left - 2) / inner) * n);
    return opts[Math.max(0, Math.min(n - 1, i))].value;
  };

  const onPointerDown = (e) => {
    setDragging(true);
    const v0 = segAt(e.clientX);
    if (v0 !== valueRef.current) onChange(v0);
    const move = (ev) => {
      if (!trackRef.current) return;
      const v = segAt(ev.clientX);
      if (v !== valueRef.current) onChange(v);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <TweakRow label={label}>
      <div ref={trackRef} role="radiogroup" onPointerDown={onPointerDown}
           className={dragging ? 'twk-seg dragging' : 'twk-seg'}>
        <div className="twk-seg-thumb"
             style={{ left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
                      width: `calc((100% - 4px) / ${n})` }} />
        {opts.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value}>
            {o.label}
          </button>
        ))}
      </div>
    </TweakRow>
  );
}

function TweakSelect({ label, value, options, onChange }) {
  return (
    <TweakRow label={label}>
      <select className="twk-field" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </TweakRow>
  );
}

function TweakText({ label, value, placeholder, onChange }) {
  return (
    <TweakRow label={label}>
      <input className="twk-field" type="text" value={value} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)} />
    </TweakRow>
  );
}

function TweakNumber({ label, value, min, max, step = 1, unit = '', onChange }) {
  const clamp = (n) => {
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };
  const startRef = React.useRef({ x: 0, val: 0 });
  const onScrubStart = (e) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, val: value };
    const decimals = (String(step).split('.')[1] || '').length;
    const move = (ev) => {
      const dx = ev.clientX - startRef.current.x;
      const raw = startRef.current.val + dx * step;
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(Number(snapped.toFixed(decimals))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="twk-num">
      <span className="twk-num-lbl" onPointerDown={onScrubStart}>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step}
             onChange={(e) => onChange(clamp(Number(e.target.value)))} />
      {unit && <span className="twk-num-unit">{unit}</span>}
    </div>
  );
}

// Relative-luminance contrast pick — checkmarks drawn over a swatch need to
// read on both #111 and #fafafa without per-option configuration. Hex input
// only (#rgb / #rrggbb); named or rgb()/hsl() colors fall through to "light".
function __twkIsLight(hex) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
}

const __TwkCheck = ({ light }) => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 7.2 5.8 10 11 4.2" fill="none" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round"
          stroke={light ? 'rgba(0,0,0,.78)' : '#fff'} />
  </svg>
);

// TweakColor — curated color/palette picker. Each option is either a single
// hex string or an array of 1-5 hex strings; the card adapts — a lone color
// renders solid, a palette renders colors[0] as the hero (left ~2/3) with the
// rest stacked in a sharp column on the right. onChange emits the
// option in the shape it was passed (string stays string, array stays array).
// Without options it falls back to the native color input for back-compat.
function TweakColor({ label, value, options, onChange }) {
  if (!options || !options.length) {
    return (
      <div className="twk-row twk-row-h">
        <div className="twk-lbl"><span>{label}</span></div>
        <input type="color" className="twk-swatch" value={value}
               onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  // Native <input type=color> emits lowercase hex per the HTML spec, so
  // compare case-insensitively. String() guards JSON.stringify(undefined),
  // which returns the primitive undefined (no .toLowerCase).
  const key = (o) => String(JSON.stringify(o)).toLowerCase();
  const cur = key(value);
  return (
    <TweakRow label={label}>
      <div className="twk-chips" role="radiogroup">
        {options.map((o, i) => {
          const colors = Array.isArray(o) ? o : [o];
          const [hero, ...rest] = colors;
          const sup = rest.slice(0, 4);
          const on = key(o) === cur;
          return (
            <button key={i} type="button" className="twk-chip" role="radio"
                    aria-checked={on} data-on={on ? '1' : '0'}
                    aria-label={colors.join(', ')} title={colors.join(' · ')}
                    style={{ background: hero }}
                    onClick={() => onChange(o)}>
              {sup.length > 0 && (
                <span>
                  {sup.map((c, j) => <i key={j} style={{ background: c }} />)}
                </span>
              )}
              {on && <__TwkCheck light={__twkIsLight(hero)} />}
            </button>
          );
        })}
      </div>
    </TweakRow>
  );
}

function TweakButton({ label, onClick, secondary = false }) {
  return (
    <button type="button" className={secondary ? 'twk-btn secondary' : 'twk-btn'}
            onClick={onClick}>{label}</button>
  );
}

Object.assign(window, {
  useTweaks, TweaksPanel, TweakSection, TweakRow,
  TweakSlider, TweakToggle, TweakRadio, TweakSelect,
  TweakText, TweakNumber, TweakColor, TweakButton,
});


// ----- src/data.jsx -----
// data.jsx — scenario data, i18n strings, icons

const STR = {
  ko: {
    appName: "gtum",
    project: "프로젝트",
    workspace: "워크스페이스",
    branch: "브랜치",
    tasks: "작업",
    providers: "에이전트 연결",
    connect: "연결",
    connected: "연결됨",
    disconnect: "연결 해제",
    files: "파일",
    gitStatus: "Git 상태",
    changes: "변경",
    ahead: "앞섬",
    behind: "뒤짐",
    clean: "깨끗함",
    dirty: "변경 있음",
    newTab: "새 탭",
    closeTab: "탭 닫기",
    renameTab: "이름 바꾸기",
    running: "실행 중",
    failed: "실패",
    idle: "유휴",
    passing: "통과",
    agentChat: "에이전트",
    suggestedActions: "제안된 작업",
    approve: "승인",
    deny: "거절",
    runInCurrent: "현재 탭에서 실행",
    runInNew: "새 탭에서 실행",
    needsApproval: "승인 필요",
    typeMessage: "에이전트에게 질문하기",
    askAgent: "질문",
    explain: "이 오류 설명해줘",
    suggestFix: "고치는 방법 제안",
    rerunTests: "테스트 재실행",
    fast: "Fast",
    balanced: "Balanced",
    deep: "Deep",
    mode: "모드",
    sendCtx: "현재 탭 출력 첨부됨",
    contextSize: "컨텍스트",
    connectProvider: "제공자 연결",
    connectIntro: "에이전트 제공자 계정을 연결하세요. OAuth 공식 로그인 흐름만 사용합니다.",
    connectDetails: "API 토큰을 직접 입력하지 않습니다. 세션은 OS 보안 저장소에 보관됩니다.",
    openBrowser: "브라우저에서 로그인",
    cancel: "취소",
    waitingCallback: "콜백을 기다리는 중…",
    connectSuccess: "연결 완료",
    sessionScope: "권한 범위",
    sessionExpiry: "세션 만료",
    days: "일",
    review: "검토",
    runCommand: "명령 실행",
    target: "대상",
    command: "명령",
    cwd: "작업 디렉토리",
    riskLow: "낮은 위험",
    riskMid: "중간 위험",
    riskHigh: "높은 위험",
    risk: "위험도",
    rollback: "필요시 되돌리기",
    explainBeforeRun: "실행 전 설명",
    you: "사용자",
    assistant: "에이전트",
    typing: "응답 생성 중",
    nowExecuting: "실행 중…",
    completed: "완료됨",
    commandHistory: "명령 기록",
    quickActions: "빠른 작업",
    statusReady: "준비됨",
    sessionsLabel: "세션",
    openProjectFolder: "프로젝트 폴더 열기",
    statusBarHint: "Cmd+K로 명령 팔레트",
    workspaceTitle: "오로라 모노레포",
    aboutContext: "에이전트가 읽을 수 있는 컨텍스트",
    contextFiles: "선택된 파일",
    contextTab: "현재 탭 출력",
    contextHistory: "최근 명령",
    save: "저장됨",
    settings: "설정",
    tabsLabel: "터미널 탭",
    activeAgent: "활성 에이전트",
    none: "없음",
    diffPreview: "diff 미리보기",
    permRead: "읽기",
    permExec: "실행",
    permEdit: "파일 수정",
    permApprove: "승인 필요",
    permGranted: "허용",
    role: "역할",
    conductor: "지휘자",
    explorer: "탐색자",
    tester: "테스터",
    operator: "운영자",
    reviewer: "리뷰어",
    coder: "코더",
    activity: "활동",
    parallelAgents: "병렬 에이전트",
    maxFiles: "최대 파일",
    maxLogs: "최대 로그",
    crossReview: "교차 리뷰",
    on: "켜짐",
    off: "꺼짐",
    splitRight: "오른쪽으로 분할",
    splitDown: "아래로 분할",
    closePane: "패널 닫기",
    pane: "패널",
    panes: "패널",
    collapse: "접기",
    expand: "펼치기",
    collapseSidebar: "사이드바 접기",
    expandSidebar: "사이드바 펼치기",
    collapseAgent: "에이전트 접기",
    expandAgent: "에이전트 펼치기",
    mergeToSingle: "하나로 합치기",
    detach: "분리",
    ctxClose: "닫기",
    ctxCloseOthers: "다른 탭 닫기",
    ctxCloseRight: "오른쪽 탭 모두 닫기",
    ctxCloseLeft: "왼쪽 탭 모두 닫기",
    ctxCloseAll: "모든 탭 닫기",
    ctxSplitRight: "오른쪽으로 분할",
    ctxSplitDown: "아래로 분할",
    ctxSplitLeft: "왼쪽으로 분할",
    ctxSplitUp: "위로 분할",
    ctxMoveRight: "오른쪽 새 그룹으로 이동",
    ctxMoveDown: "아래 새 그룹으로 이동",
    ctxNewGroup: "새 그룹으로 이동",
    emptyGroup: "탭을 끌어다 놓거나 새로 여세요",
    newTabHere: "여기에 새 탭",
    settings: "설정",
    settingsTitle: "설정",
    settingsConnections: "에이전트 연결",
    settingsModels: "모델",
    settingsAppearance: "외관",
    settingsExecution: "실행",
    settingsAbout: "정보",
    selectedModel: "선택된 모델",
    activeProvider: "활성 제공자",
    contextWindow: "컨텍스트 창",
    responseSpeed: "응답 속도",
    tier: "분류",
    saveSettings: "저장",
    pickModel: "모델 선택",
    noConnectedProviders: "연결된 제공자가 없습니다",
    parallelLimit: "병렬 워커 수",
    autoApproveLow: "낮은 위험 자동 승인",
    streamResponses: "응답 스트리밍",
    approvalPolicy: "승인 정책",
    presetCautious: "신중",
    presetDefault: "기본",
    presetBold: "공격적",
    presetCustom: "맞춤",
    approvalLevel: "승인 수준",
    actionAlwaysAsk: "항상 묻기",
    actionAuto: "자동 승인",
    actionAutoTrusted: "신뢰된 경로만",
    riskLowFull: "낮은 위험 명령",
    riskMidFull: "중간 위험 명령",
    riskHighFull: "높은 위험 명령",
    riskLowDesc: "읽기, 빌드, 테스트, 포트 점유 해소 등",
    riskMidDesc: "프로세스 종료, 패키지 설치, 캐시 삭제",
    riskHighDesc: "git push --force, fly deploy, rm -rf 등",
    trustedDirs: "신뢰된 경로",
    trustedDirsHint: "이 디렉토리 안에서만 자동 승인이 적용됩니다",
    forbiddenPatterns: "차단된 패턴",
    forbiddenPatternsHint: "이 패턴은 정책과 무관하게 항상 확인합니다",
    addPattern: "패턴 추가",
    addDir: "경로 추가",
    autoApproveLog: "최근 자동 승인",
    noAutoApprovals: "아직 자동 승인된 명령이 없습니다",
    undo: "되돌리기",
    toastAutoRan: "자동 실행됨",
    autoRanInline: "낮은 위험 — 자동 실행",
    blockedByPattern: "차단된 패턴",
    requiresHigher: "이 명령은 더 높은 위험 등급이므로 확인이 필요합니다",
    streamResponsesHint: "에이전트 응답을 한 글자씩 흘려보냅니다",
    parallelLimitHint: "동시에 실행되는 워커의 최대 개수",
    auditTrail: "감사 로그",
    revert: "되돌리기",
  },
  en: {
    appName: "gtum",
    project: "Project",
    workspace: "Workspace",
    branch: "Branch",
    tasks: "Tasks",
    providers: "Agent providers",
    connect: "Connect",
    connected: "Connected",
    disconnect: "Disconnect",
    files: "Files",
    gitStatus: "Git status",
    changes: "changes",
    ahead: "ahead",
    behind: "behind",
    clean: "clean",
    dirty: "dirty",
    newTab: "New tab",
    closeTab: "Close tab",
    renameTab: "Rename",
    running: "Running",
    failed: "Failed",
    idle: "Idle",
    passing: "Passing",
    agentChat: "Agent",
    suggestedActions: "Suggested actions",
    approve: "Approve",
    deny: "Deny",
    runInCurrent: "Run in current tab",
    runInNew: "Run in new tab",
    needsApproval: "Needs approval",
    typeMessage: "Ask the agent",
    askAgent: "Ask",
    explain: "Explain this error",
    suggestFix: "Suggest a fix",
    rerunTests: "Rerun tests",
    fast: "Fast",
    balanced: "Balanced",
    deep: "Deep",
    mode: "Mode",
    sendCtx: "current tab output attached",
    contextSize: "Context",
    connectProvider: "Connect a provider",
    connectIntro: "Connect your agent provider account. OAuth official sign-in only.",
    connectDetails: "We never ask for raw API tokens. Sessions live in the OS secure store.",
    openBrowser: "Open browser to sign in",
    cancel: "Cancel",
    waitingCallback: "Waiting for callback…",
    connectSuccess: "Connected",
    sessionScope: "Granted scope",
    sessionExpiry: "Session expires in",
    days: "days",
    review: "Review",
    runCommand: "Run command",
    target: "Target",
    command: "Command",
    cwd: "Working directory",
    riskLow: "Low risk",
    riskMid: "Medium risk",
    riskHigh: "High risk",
    risk: "Risk",
    rollback: "Reversible",
    explainBeforeRun: "Pre-run notes",
    you: "You",
    assistant: "Agent",
    typing: "thinking",
    nowExecuting: "Executing…",
    completed: "Completed",
    commandHistory: "Command history",
    quickActions: "Quick actions",
    statusReady: "Ready",
    sessionsLabel: "Sessions",
    openProjectFolder: "Open project folder",
    statusBarHint: "Cmd+K for palette",
    workspaceTitle: "aurora-monorepo",
    aboutContext: "Context the agent can read",
    contextFiles: "Selected files",
    contextTab: "Current tab output",
    contextHistory: "Recent commands",
    save: "Saved",
    settings: "Settings",
    tabsLabel: "Terminal tabs",
    activeAgent: "Active agent",
    none: "None",
    diffPreview: "Diff preview",
    permRead: "Read",
    permExec: "Execute",
    permEdit: "Edit files",
    permApprove: "Approval required",
    permGranted: "Allowed",
    role: "Role",
    conductor: "Conductor",
    explorer: "Explorer",
    tester: "Tester",
    operator: "Operator",
    reviewer: "Reviewer",
    coder: "Coder",
    activity: "Activity",
    parallelAgents: "Parallel agents",
    maxFiles: "Max files",
    maxLogs: "Max log lines",
    crossReview: "Cross review",
    on: "on",
    off: "off",
    splitRight: "Split right",
    splitDown: "Split down",
    closePane: "Close pane",
    pane: "pane",
    panes: "panes",
    collapse: "Collapse",
    expand: "Expand",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    collapseAgent: "Collapse agent",
    expandAgent: "Expand agent",
    mergeToSingle: "Merge to single",
    detach: "Detach",
    ctxClose: "Close",
    ctxCloseOthers: "Close Others",
    ctxCloseRight: "Close to the Right",
    ctxCloseLeft: "Close to the Left",
    ctxCloseAll: "Close All",
    ctxSplitRight: "Split Right",
    ctxSplitDown: "Split Down",
    ctxSplitLeft: "Split Left",
    ctxSplitUp: "Split Up",
    ctxMoveRight: "Move into New Group Right",
    ctxMoveDown: "Move into New Group Down",
    ctxNewGroup: "Move into New Group",
    emptyGroup: "Drag a tab here, or open a new one",
    newTabHere: "New tab here",
    settingsTitle: "Settings",
    settingsConnections: "Agent connections",
    settingsModels: "Models",
    settingsAppearance: "Appearance",
    settingsExecution: "Execution",
    settingsAbout: "About",
    selectedModel: "Selected model",
    activeProvider: "Active provider",
    contextWindow: "Context window",
    responseSpeed: "Response speed",
    tier: "Tier",
    saveSettings: "Save",
    pickModel: "Pick model",
    noConnectedProviders: "No providers connected",
    parallelLimit: "Parallel workers",
    autoApproveLow: "Auto-approve low risk",
    streamResponses: "Stream responses",
    approvalPolicy: "Approval policy",
    presetCautious: "Cautious",
    presetDefault: "Default",
    presetBold: "Bold",
    presetCustom: "Custom",
    approvalLevel: "Approval level",
    actionAlwaysAsk: "Always ask",
    actionAuto: "Auto-approve",
    actionAutoTrusted: "Trusted dirs only",
    riskLowFull: "Low-risk commands",
    riskMidFull: "Medium-risk commands",
    riskHighFull: "High-risk commands",
    riskLowDesc: "Reads, builds, tests, freeing a port",
    riskMidDesc: "Killing processes, installing packages, clearing caches",
    riskHighDesc: "git push --force, fly deploy, rm -rf, etc.",
    trustedDirs: "Trusted directories",
    trustedDirsHint: "Auto-approve only applies inside these paths",
    forbiddenPatterns: "Forbidden patterns",
    forbiddenPatternsHint: "Always confirm these regardless of policy",
    addPattern: "Add pattern",
    addDir: "Add directory",
    autoApproveLog: "Recent auto-approvals",
    noAutoApprovals: "No commands auto-approved yet",
    undo: "Undo",
    toastAutoRan: "Auto-ran",
    autoRanInline: "Low risk — auto-ran",
    blockedByPattern: "Blocked by pattern",
    requiresHigher: "This command needs explicit approval at its risk level",
    streamResponsesHint: "Stream agent replies character by character",
    parallelLimitHint: "Max workers running in parallel",
    auditTrail: "Audit trail",
    revert: "Revert",
  },
};

const t = (lang, key) => (STR[lang] && STR[lang][key]) || STR.en[key] || key;

const PROJECT = {
  name: "aurora-monorepo",
  path: "~/code/aurora-monorepo",
  branch: "feature/onboarding-funnel",
  branchType: "feature",
  ahead: 3,
  behind: 0,
  changedFiles: 7,
  fileTree: [
    { name: "apps", type: "dir", open: true, children: [
      { name: "web", type: "dir", open: true, children: [
        { name: "src", type: "dir", open: true, children: [
          { name: "OnboardingFunnel.tsx", type: "ts", changed: true, selected: true },
          { name: "useFunnelState.ts", type: "ts", changed: true },
          { name: "main.tsx", type: "ts" },
        ]},
        { name: "package.json", type: "json" },
        { name: "vite.config.ts", type: "ts" },
      ]},
      { name: "api", type: "dir", open: true, children: [
        { name: "src", type: "dir", open: false },
        { name: "server.ts", type: "ts", changed: true },
        { name: "package.json", type: "json", changed: true },
      ]},
    ]},
    { name: "packages", type: "dir", open: false },
    { name: "tests", type: "dir", open: true, children: [
      { name: "funnel.spec.ts", type: "ts", changed: true },
      { name: "checkout.spec.ts", type: "ts" },
    ]},
    { name: "package.json", type: "json" },
    { name: "pnpm-workspace.yaml", type: "yaml" },
    { name: "README.md", type: "md" },
  ],
};

async function selectRuntimeProjectFolder(defaultPath) {
  if (!hasTauriRuntime()) return defaultPath || PROJECT.path;

  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: "Choose a project folder",
    defaultPath: defaultPath || undefined,
  });

  return typeof selected === "string" ? selected : null;
}

// VS Code-style workspace.
//
// layoutTree is a binary tree where:
//   - leaves are { type: 'group', groupId } pointing into `groups`
//   - branches are { type: 'split', direction: 'horizontal'|'vertical',
//                    children: [TreeNode, ...], sizes: [pct, ...] }
//     'horizontal' = children laid out side-by-side (row)
//     'vertical'   = children stacked top-to-bottom (column)
//
// `groups` is a dictionary keyed by groupId for O(1) lookup; each group has
// its own tabbar (tabs[] + activeTabId). Tabs own the shell session data.
const WORKSPACE_INITIAL = {
  layoutTree: {
    type: "split",
    direction: "vertical",
    sizes: [62, 38],
    children: [
      { type: "group", groupId: "g-1" },
      { type: "group", groupId: "g-2" },
    ],
  },
  activeGroupId: "g-1",
  groups: {
    "g-1": {
      id: "g-1",
      activeTabId: "t-backend",
      tabs: [
        {
          id: "t-frontend", title: "frontend",
          shell: "pnpm", cwd: "apps/web",
          status: "running", cmd: "pnpm dev",
          lines: [
            { kind: "cmd", text: "pnpm dev" },
            { kind: "log", text: "> aurora-web@0.4.2 dev /Users/yj/code/aurora-monorepo/apps/web" },
            { kind: "log", text: "> vite --port 5173" },
            { kind: "log", text: "" },
            { kind: "log", text: "  VITE v5.2.11  ready in 412 ms", color: "ok" },
            { kind: "log", text: "" },
            { kind: "log", text: "  ➜  Local:   http://localhost:5173/" },
            { kind: "log", text: "  ➜  Network: use --host to expose" },
            { kind: "log", text: "" },
            { kind: "log", text: "10:24:18 [vite] hmr update /src/OnboardingFunnel.tsx", color: "dim" },
            { kind: "log", text: "10:24:51 [vite] hmr update /src/useFunnelState.ts", color: "dim" },
            { kind: "log", text: "10:25:14 [vite] page reload /src/main.tsx", color: "dim" },
          ],
        },
        {
          id: "t-backend", title: "backend",
          shell: "pnpm", cwd: "apps/api",
          status: "failed", cmd: "pnpm dev:api",
          lines: [
            { kind: "cmd", text: "pnpm dev:api" },
            { kind: "log", text: "> aurora-api@0.4.2 dev:api /Users/yj/code/aurora-monorepo/apps/api" },
            { kind: "log", text: "> tsx watch src/server.ts" },
            { kind: "log", text: "" },
            { kind: "log", text: "[api] initializing kysely pool…", color: "dim" },
            { kind: "log", text: "[api] loaded 12 routes" },
            { kind: "log", text: "[api] listening on http://localhost:3001 ⏳", color: "dim" },
            { kind: "log", text: "" },
            { kind: "log", text: "Error: listen EADDRINUSE: address already in use :::3001", color: "err" },
            { kind: "log", text: "    at Server.setupListenHandle [as _listen2] (node:net:1908:16)", color: "err-dim" },
            { kind: "log", text: "    at listenInCluster (node:net:1956:12)", color: "err-dim" },
            { kind: "log", text: "    at Server.listen (node:net:2058:7)", color: "err-dim" },
            { kind: "log", text: "    at start (file:///…/apps/api/src/server.ts:48:10)", color: "err-dim" },
            { kind: "log", text: "" },
            { kind: "log", text: "node:events:497", color: "err-dim" },
            { kind: "log", text: "      throw er; // Unhandled 'error' event", color: "err-dim" },
            { kind: "log", text: "      ^", color: "err-dim" },
            { kind: "log", text: "✖ process exited with code 1", color: "err" },
          ],
        },
        {
          id: "t-tests", title: "tests",
          shell: "pnpm", cwd: ".",
          status: "failed", cmd: "pnpm test:funnel",
          lines: [
            { kind: "cmd", text: "pnpm test:funnel" },
            { kind: "log", text: "> aurora@0.4.2 test:funnel" },
            { kind: "log", text: "> vitest run tests/funnel.spec.ts" },
            { kind: "log", text: "" },
            { kind: "log", text: " RUN  v1.6.0  /Users/yj/code/aurora-monorepo", color: "dim" },
            { kind: "log", text: "" },
            { kind: "log", text: " ❯ tests/funnel.spec.ts  (8)", color: "warn" },
            { kind: "log", text: "   ✓ persists step on refresh", color: "ok" },
            { kind: "log", text: "   ✓ goes back without losing answers", color: "ok" },
            { kind: "log", text: "   ✓ submits valid payload", color: "ok" },
            { kind: "log", text: "   ✓ derives progress %", color: "ok" },
            { kind: "log", text: "   ✓ blocks empty step", color: "ok" },
            { kind: "log", text: "   ✓ handles back from final step", color: "ok" },
            { kind: "log", text: "   ✗ FunnelState › skipping optional step keeps progress", color: "err" },
            { kind: "log", text: "       AssertionError: expected 60 to be 50", color: "err-dim" },
            { kind: "log", text: "       ❯ tests/funnel.spec.ts:74:22", color: "err-dim" },
            { kind: "log", text: "   ✗ FunnelState › resume after 24h marks stale", color: "err" },
            { kind: "log", text: "       Error: expected staleness flag to be set", color: "err-dim" },
            { kind: "log", text: "" },
            { kind: "log", text: " Test Files  1 failed (1)", color: "err" },
            { kind: "log", text: "      Tests  2 failed | 6 passed (8)", color: "err" },
            { kind: "log", text: "   Duration  1.42s", color: "dim" },
          ],
        },
      ],
    },
    "g-2": {
      id: "g-2",
      activeTabId: "t-fly",
      tabs: [
        {
          id: "t-git", title: "git",
          shell: "zsh", cwd: ".",
          status: "passing", cmd: "git status",
          lines: [
            { kind: "cmd", text: "git status" },
            { kind: "log", text: "On branch feature/onboarding-funnel" },
            { kind: "log", text: "Your branch is ahead of 'origin/master' by 3 commits.", color: "dim" },
            { kind: "log", text: "  (use \"git push\" to publish your local commits)", color: "dim" },
            { kind: "log", text: "" },
            { kind: "log", text: "Changes not staged for commit:", color: "warn" },
            { kind: "log", text: "  (use \"git add <file>...\" to update what will be committed)", color: "dim" },
            { kind: "log", text: "" },
            { kind: "log", text: "        modified:   apps/web/src/OnboardingFunnel.tsx", color: "err" },
            { kind: "log", text: "        modified:   apps/web/src/useFunnelState.ts", color: "err" },
            { kind: "log", text: "        modified:   apps/api/src/server.ts", color: "err" },
            { kind: "log", text: "        modified:   apps/api/package.json", color: "err" },
            { kind: "log", text: "        modified:   tests/funnel.spec.ts", color: "err" },
            { kind: "log", text: "" },
            { kind: "log", text: "no changes added to commit (use \"git add\" and/or \"git commit -a\")", color: "dim" },
          ],
        },
        {
          id: "t-fly", title: "fly deploy",
          shell: "fly", cwd: ".",
          status: "running", cmd: "fly deploy --watch",
          lines: [
            { kind: "cmd", text: "fly deploy --watch" },
            { kind: "log", text: "==> Verifying app config" },
            { kind: "log", text: "Validating /Users/yj/code/aurora-monorepo/fly.toml", color: "dim" },
            { kind: "log", text: "Platform: machines" },
            { kind: "log", text: "✓ Configuration is valid", color: "ok" },
            { kind: "log", text: "--> Verified app config" },
            { kind: "log", text: "==> Building image" },
            { kind: "log", text: "Remote builder fly-builder-jolly-snow ready", color: "dim" },
            { kind: "log", text: " => [internal] load build definition       0.0s", color: "dim" },
            { kind: "log", text: " => [build 1/8] FROM docker.io/node:20-bookworm  4.2s", color: "dim" },
            { kind: "log", text: " => [build 2/8] WORKDIR /app                0.1s", color: "dim" },
            { kind: "log", text: " => [build 3/8] COPY pnpm-lock.yaml         0.0s", color: "dim" },
            { kind: "log", text: " => [build 4/8] RUN corepack enable         1.8s", color: "dim" },
            { kind: "log", text: " => [build 5/8] RUN pnpm install --frozen-lockfile  12.4s", color: "dim" },
            { kind: "log", text: " => [build 6/8] COPY . .                    0.3s", color: "dim" },
            { kind: "log", text: " => [build 7/8] RUN pnpm -r build           ⏳", color: "warn" },
          ],
        },
      ],
    },
  },
};

const PROVIDERS_INIT = [
  {
    id: "claude",
    label: "Claude",
    abbr: "Cl",
    state: "connected",
    scope: ["files.read", "terminal.read", "exec.suggest"],
    expiresInDays: 27,
    activeModel: "claude-sonnet-4.5",
    models: [
      { id: "claude-opus-4.5",   label: "Claude Opus 4.5",   tier: "deep",     ctx: "200K", speed: "느림" },
      { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", tier: "balanced", ctx: "200K", speed: "보통" },
      { id: "claude-haiku-4.5",  label: "Claude Haiku 4.5",  tier: "fast",     ctx: "200K", speed: "빠름" },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    abbr: "Cx",
    state: "disconnected",
    scope: [],
    expiresInDays: null,
    activeModel: "gpt-5-codex",
    models: [
      { id: "gpt-5",         label: "GPT-5",         tier: "deep",     ctx: "256K", speed: "느림" },
      { id: "gpt-5-codex",   label: "GPT-5 Codex",   tier: "balanced", ctx: "200K", speed: "보통" },
      { id: "gpt-5-mini",    label: "GPT-5 mini",    tier: "fast",     ctx: "128K", speed: "빠름" },
      { id: "o4-mini",       label: "o4-mini",       tier: "deep",     ctx: "128K", speed: "느림" },
    ],
  },
];

const CHAT_INIT = (lang) => [
  {
    id: "m1",
    role: "user",
    at: "10:24",
    content: lang === "ko"
      ? "백엔드 탭이 떨어졌어. 한번 봐줘."
      : "Backend tab just crashed. Take a look.",
    contextAttached: ["t-backend"],
  },
  {
    id: "m2",
    role: "assistant",
    at: "10:24",
    roleLabel: lang === "ko" ? "탐색자" : "Explorer",
    content: lang === "ko"
      ? "backend 탭 로그를 읽었어. `tsx watch src/server.ts`가 `EADDRINUSE :::3001`로 죽었어 — 누군가 이미 3001을 쓰고 있어."
      : "I read the backend tab output. `tsx watch src/server.ts` died with `EADDRINUSE :::3001` — something else is already on 3001.",
  },
  {
    id: "m3",
    role: "assistant",
    at: "10:24",
    roleLabel: lang === "ko" ? "리뷰어" : "Reviewer",
    content: lang === "ko"
      ? "최근 명령 기록을 보니 4분 전에 같은 서버를 한번 띄웠어. 좀비 프로세스일 가능성이 커. 죽이고 다시 띄우는 게 안전해."
      : "Recent history shows the same server was launched 4 minutes ago. Likely a zombie process — safe to kill and restart.",
  },
  {
    id: "m4",
    role: "assistant",
    at: "10:25",
    suggestion: {
      id: "sg-1",
      title: lang === "ko" ? "포트 3001 점유 프로세스 종료 후 backend 재실행" : "Kill the process on :3001, restart backend",
      commands: [
        { cmd: "lsof -ti:3001 | xargs -r kill -9", risk: "mid", target: "new" },
        { cmd: "pnpm dev:api", risk: "low", target: "t-backend" },
      ],
      note: lang === "ko"
        ? "되돌리기 쉬움. 첫 명령은 새 탭에서, 두 번째는 backend 탭에서 실행."
        : "Reversible. First command in a new tab, second in the backend tab.",
    },
  },
];

const COMMAND_HISTORY_INIT = [
  { at: "10:18", tab: "frontend", cmd: "pnpm dev", ok: true },
  { at: "10:20", tab: "backend", cmd: "pnpm dev:api", ok: true },
  { at: "10:21", tab: "tests", cmd: "pnpm test:funnel", ok: false },
  { at: "10:24", tab: "backend", cmd: "pnpm dev:api", ok: false },
];

const TASKS_INIT = (lang) => [
  { id: "tk1", label: lang === "ko" ? "온보딩 퍼널 — 진행률 계산 버그 수정" : "Onboarding funnel — progress bug fix", status: "active", agent: "Coder" },
  { id: "tk2", label: lang === "ko" ? "stale resume 플래그 동작 검증" : "Verify stale-resume flag behavior", status: "waiting", agent: "Tester" },
  { id: "tk3", label: lang === "ko" ? "Kysely 풀 종료 핸들러 추가" : "Add Kysely pool shutdown handler", status: "queued", agent: "Coder" },
  { id: "tk4", label: lang === "ko" ? "변경 사항 PR 초안 작성" : "Draft PR summary for changes", status: "queued", agent: "Reviewer" },
];

const Icon = {
  chevron: (props) => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" {...props}>
      <path d="M3 2 L7 5 L3 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevronDown: (props) => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" {...props}>
      <path d="M2 3 L5 7 L8 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  plus: (props) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...props}>
      <path d="M6 2 V10 M2 6 H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  x: (props) => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" {...props}>
      <path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  send: (props) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...props}>
      <path d="M2 7 L12 7 M8 3 L12 7 L8 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  dot: (props) => (
    <svg width="8" height="8" viewBox="0 0 8 8" {...props}>
      <circle cx="4" cy="4" r="3" fill="currentColor" />
    </svg>
  ),
  branch: (props) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...props}>
      <circle cx="3" cy="2.5" r="1.2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="3" cy="9.5" r="1.2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="9" cy="4" r="1.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 3.7 V8.3 M3 6 Q3 4 5 4 H7.8" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  ),
  spark: (props) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...props}>
      <path d="M6 1.5 L6.9 5.1 L10.5 6 L6.9 6.9 L6 10.5 L5.1 6.9 L1.5 6 L5.1 5.1 Z" fill="currentColor" />
    </svg>
  ),
  folder: (props) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...props}>
      <path d="M1.5 3.5 H4.5 L5.5 4.5 H10.5 V9.5 H1.5 Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  ),
  file: (props) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...props}>
      <path d="M3 2 H7.5 L9 3.5 V10 H3 Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  ),
  shield: (props) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...props}>
      <path d="M6 1.5 L10 3 V6.5 Q10 9 6 10.5 Q2 9 2 6.5 V3 Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  ),
  splitH: (props) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...props}>
      <rect x="1.5" y="2" width="9" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M6 2 V10" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
  splitV: (props) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...props}>
      <rect x="1.5" y="2" width="9" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M1.5 6 H10.5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
  merge: (props) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...props}>
      <rect x="1.5" y="2" width="9" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M3 4 L5.5 6 L3 8 M9 4 L6.5 6 L9 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),
  panelLeft: (props) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...props}>
      <rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 2 V12" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  panelRight: (props) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...props}>
      <rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 2 V12" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  drag: (props) => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" {...props}>
      <circle cx="3" cy="2" r="0.8" fill="currentColor" />
      <circle cx="7" cy="2" r="0.8" fill="currentColor" />
      <circle cx="3" cy="5" r="0.8" fill="currentColor" />
      <circle cx="7" cy="5" r="0.8" fill="currentColor" />
      <circle cx="3" cy="8" r="0.8" fill="currentColor" />
      <circle cx="7" cy="8" r="0.8" fill="currentColor" />
    </svg>
  ),
  gear: (props) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...props}>
      <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 1.6 V3.4 M7 10.6 V12.4 M1.6 7 H3.4 M10.6 7 H12.4 M3 3 L4.2 4.2 M9.8 9.8 L11 11 M11 3 L9.8 4.2 M4.2 9.8 L3 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
};

// Derive a status badge for a whole group from its tabs — worst-status wins.
// Used in sidebar / activity indicators / drag chrome.
const STATUS_ORDER = { failed: 4, running: 3, passing: 2, idle: 1 };
function groupStatus(group) {
  let best = group.tabs[0]?.status || "idle";
  for (const tab of group.tabs) {
    if ((STATUS_ORDER[tab.status] || 0) > (STATUS_ORDER[best] || 0)) best = tab.status;
  }
  return best;
}
function workspaceStatus(workspace) {
  // worst status across every tab
  let best = "idle";
  for (const g of Object.values(workspace.groups)) {
    const s = groupStatus(g);
    if ((STATUS_ORDER[s] || 0) > (STATUS_ORDER[best] || 0)) best = s;
  }
  return best;
}
// Active tab of the active group — used by the agent context summary, etc.
function activeTabOf(workspace) {
  const g = workspace.groups[workspace.activeGroupId];
  if (!g) return null;
  return g.tabs.find((tb) => tb.id === g.activeTabId) || g.tabs[0] || null;
}
function findTab(workspace, tabId) {
  for (const g of Object.values(workspace.groups)) {
    const t = g.tabs.find((tb) => tb.id === tabId);
    if (t) return { tab: t, group: g };
  }
  return null;
}
function allTabs(workspace) {
  const out = [];
  for (const g of Object.values(workspace.groups)) {
    for (const tab of g.tabs) out.push({ tab, groupId: g.id });
  }
  return out;
}

// File content for editor tabs — keyed by full path in the file tree.
const FILE_CONTENTS = {
  "apps/web/src/OnboardingFunnel.tsx": { lang: "tsx", dirty: true, text:
`import { useEffect } from "react";
import { useFunnelState } from "./useFunnelState";
import { StepCard } from "./StepCard";
import { ProgressBar } from "./ProgressBar";

type Props = {
  steps: FunnelStep[];
  onSubmit: (payload: FunnelPayload) => void;
};

export function OnboardingFunnel({ steps, onSubmit }: Props) {
  const funnel = useFunnelState(steps);

  useEffect(() => {
    if (funnel.isComplete) onSubmit(funnel.payload);
  }, [funnel.isComplete, funnel.payload, onSubmit]);

  return (
    <div className="funnel">
      <ProgressBar value={funnel.progress} />
      <StepCard
        step={funnel.current}
        answer={funnel.answer}
        onChange={funnel.answer$.next}
        onBack={funnel.back}
        onNext={funnel.next}
      />
    </div>
  );
}` },
  "apps/web/src/useFunnelState.ts": { lang: "ts", dirty: true, text:
`import { useMemo, useState } from "react";
import { Subject } from "rxjs";

/**
 * useFunnelState — manages step navigation + progress
 * BUG: progress calc doesn't drop optional skipped steps
 */
export function useFunnelState(steps: FunnelStep[]) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  const current = steps[idx];
  const answer$ = useMemo(() => new Subject<unknown>(), []);

  // FIXME — should exclude optional steps that were skipped
  const progress = Math.round(((idx + 1) / steps.length) * 100);

  return {
    current, answer: answers[current?.id],
    progress,
    isComplete: idx >= steps.length,
    answer$,
    payload: answers,
    back: () => setIdx((i) => Math.max(0, i - 1)),
    next: () => setIdx((i) => i + 1),
  };
}` },
  "apps/api/src/server.ts": { lang: "ts", dirty: true, text:
`import { createServer } from "node:http";
import { router } from "./router";
import { kysely } from "./db/kysely";

const PORT = 3001;

async function start() {
  console.log("[api] initializing kysely pool…");
  await kysely.connect();
  const server = createServer(router);
  // FIXME: no graceful shutdown — leaves the port hot on restart
  server.listen(PORT, () => {
    console.log(\`[api] listening on http://localhost:\${PORT}\`);
  });
}

start().catch((err) => { console.error(err); process.exit(1); });` },
  "tests/funnel.spec.ts": { lang: "ts", dirty: true, text:
`import { renderHook, act } from "@testing-library/react";
import { useFunnelState } from "../apps/web/src/useFunnelState";
import { describe, it, expect } from "vitest";

const steps = [
  { id: "name",    optional: false },
  { id: "email",   optional: false },
  { id: "team",    optional: true  },
  { id: "billing", optional: false },
];

describe("FunnelState", () => {
  it("skipping optional step keeps progress", () => {
    const { result } = renderHook(() => useFunnelState(steps));
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.next());
    // expected 50, optional removed from denominator
    expect(result.current.progress).toBe(50);
  });
});` },
};

// Make an editor-shaped tab from a file tree node + its full path.
function tabFromFile(path, name) {
  const c = FILE_CONTENTS[path];
  return {
    id: "ed-" + path.replace(/[^a-z0-9]+/gi, "-"),
    type: "editor",
    title: name,
    path,
    displayPath: path,
    lang: c?.lang || "txt",
    content: c?.text || "// (no content for this file in the prototype)",
    isText: true,
    truncated: false,
    dirty: !!c?.dirty,
    status: "idle",
    cwd: ".", cmd: null, shell: null, lines: [],
  };
}

const projectRuntimeService = createProjectRuntimeService({
  fallbackProject: PROJECT,
  fallbackFileReader: tabFromFile,
});
const agentAuthRuntimeService = createAgentAuthRuntimeService();
const agentSuggestionRuntimeService = createAgentSuggestionRuntimeService();
const terminalRuntimeService = createTerminalRuntimeService();

function mergeRuntimeProviderConnections(providers, connections) {
  const patches = new Map(connections.map((connection) => {
    const patch = providerViewStateFromConnection(connection);
    return [patch.id, patch];
  }));

  return providers.map((provider) => {
    const patch = patches.get(provider.id);
    if (!patch) return provider;

    return {
      ...provider,
      ...patch,
      activeModel: provider.activeModel,
      models: provider.models,
    };
  });
}

async function readRuntimeProjectOverview(path) {
  const result = await projectRuntimeService.readProjectOverview(path);
  return result.project;
}

async function readRuntimeProjectFile(project, filePath, fallbackName) {
  return projectRuntimeService.readProjectFile(project, filePath, fallbackName);
}

// Walk file tree to find the full path of a given node.
function pathOfNode(tree, target, parents = []) {
  for (const node of tree) {
    if (node === target) return [...parents, node.name].join("/");
    if (node.children) {
      const hit = pathOfNode(node.children, target, [...parents, node.name]);
      if (hit) return hit;
    }
  }
  return null;
}

// Lightweight syntax tokenizer for TS/TSX — keyword, string, comment, number.
const __TS_KW = new Set("import|from|export|const|let|var|function|return|if|else|for|while|switch|case|default|break|continue|new|class|extends|implements|interface|type|enum|async|await|try|catch|finally|throw|typeof|instanceof|void|null|undefined|true|false|this|super|in|of|as|is|public|private|protected|readonly|static|abstract|yield|delete".split("|"));
function tokenizeLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    // line comment
    let m = rest.match(/^\/\/[^\n]*/);
    if (m) { out.push({ k: "com", t: m[0] }); i += m[0].length; continue; }
    // block comment (single-line only here)
    m = rest.match(/^\/\*[^]*?\*\//);
    if (m) { out.push({ k: "com", t: m[0] }); i += m[0].length; continue; }
    // string
    m = rest.match(/^"([^"\\]|\\.)*"|^'([^'\\]|\\.)*'|^`([^`\\]|\\.)*`/);
    if (m) { out.push({ k: "str", t: m[0] }); i += m[0].length; continue; }
    // number
    m = rest.match(/^\d+(?:\.\d+)?/);
    if (m) { out.push({ k: "num", t: m[0] }); i += m[0].length; continue; }
    // identifier
    m = rest.match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (m) {
      const w = m[0];
      out.push({ k: __TS_KW.has(w) ? "kw" : /^[A-Z]/.test(w) ? "ty" : "id", t: w });
      i += w.length; continue;
    }
    // single char
    out.push({ k: "p", t: line[i] });
    i += 1;
  }
  return out;
}

// ── Approval policy ─────────────────────────────────────────────────────
//
// Policy decides whether a command is auto-approved or routed through the
// approval modal. We model 3 risk levels with separate rules + an absolute
// allowlist (trusted dirs) and denylist (forbidden patterns).
//
// Preset semantics:
//   cautious — every command always asks; no shortcuts.
//   default  — low-risk auto-runs anywhere; mid/high always ask.
//   bold     — low+mid auto-run inside trusted dirs; high always asks.
//
// Forbidden patterns are checked first and always force "always-ask",
// even if the policy would auto-approve. High-risk is hard-coded to
// always-ask — you cannot disable it.
const APPROVAL_PRESETS = {
  cautious: { lowRisk: "always-ask", midRisk: "always-ask" },
  default:  { lowRisk: "auto",       midRisk: "always-ask" },
  bold:     { lowRisk: "auto",       midRisk: "auto-trusted" },
};

const APPROVAL_POLICY_INIT = {
  preset: "default",
  lowRisk: "auto",
  midRisk: "always-ask",
  // highRisk is always "always-ask" — not stored, just enforced.
  trustedDirs: ["~/code/aurora-monorepo"],
  forbiddenPatterns: ["rm -rf", "git push --force", "sudo", "dd if="],
};

// Decide what to do with a command:
//   { action: 'auto' } → execute without modal
//   { action: 'ask', reason }  → open approval modal
function policyDecideForCommand(policy, cmd, risk, cwd) {
  const text = cmd || "";
  // 1. Forbidden patterns override everything
  for (const pat of policy.forbiddenPatterns) {
    if (text.toLowerCase().includes(pat.toLowerCase())) {
      return { action: "ask", reason: "forbidden", pattern: pat };
    }
  }
  // 2. High risk → always ask
  if (risk === "high") return { action: "ask", reason: "high-risk" };
  // 3. Policy by risk level
  const rule = risk === "low" ? policy.lowRisk : policy.midRisk;
  if (rule === "auto") return { action: "auto" };
  if (rule === "auto-trusted") {
    // Auto-approve only if cwd is inside a trusted dir
    const inTrusted = policy.trustedDirs.some(
      (d) => (cwd || "").startsWith(d.replace(/^~/, ""))
    );
    return inTrusted ? { action: "auto" } : { action: "ask", reason: "not-trusted" };
  }
  return { action: "ask", reason: "policy" };
}

// Whole-suggestion decision — auto-runs only if EVERY command auto-runs.
// One blocker means we open the modal with the full list.
function policyDecideForSuggestion(policy, suggestion, cwd) {
  const decisions = suggestion.commands.map(
    (c) => ({ cmd: c, decision: policyDecideForCommand(policy, c.cmd, c.risk, cwd) })
  );
  const blocker = decisions.find((d) => d.decision.action === "ask");
  if (blocker) return { action: "ask", blocker, decisions };
  return { action: "auto", decisions };
}

Object.assign(window, {
  STR, t,
  PROJECT, WORKSPACE_INITIAL, PROVIDERS_INIT,
  CHAT_INIT, COMMAND_HISTORY_INIT, TASKS_INIT,
  Icon,
  groupStatus, workspaceStatus, activeTabOf, findTab, allTabs,
  APPROVAL_PRESETS, APPROVAL_POLICY_INIT,
  policyDecideForCommand, policyDecideForSuggestion,
  FILE_CONTENTS, tabFromFile, pathOfNode, tokenizeLine,
});


// ----- src/workspace-store.jsx -----
// workspace-store.jsx — pure functions for VS Code-style workspace state.
//
// State shape:
//   workspace = {
//     layoutTree,    // recursive { type, ... }
//     groups,        // { [groupId]: Group }
//     activeGroupId, // string
//   }
//
// Group:
//   { id, activeTabId, tabs: [Tab] }
//
// Tab:
//   { id, title, shell, cwd, status, cmd, lines }
//
// LayoutTree node:
//   - leaf: { type: 'group', groupId }
//   - split: { type: 'split', direction: 'horizontal' | 'vertical',
//              sizes: [%, %, ...], children: [Node, ...] }
//
// 'horizontal' = side-by-side (row), 'vertical' = stacked (col).
//
// Every exported action is a pure function: (state, ...args) → newState.

// ── id helpers ──────────────────────────────────────────────────────────
let __gtumIdCounter = 0;
function uid(prefix) {
  __gtumIdCounter += 1;
  // Time + counter avoids collisions even within the same millisecond.
  return prefix + "-" + Date.now().toString(36) + "-" + __gtumIdCounter;
}

// ── tree utils ──────────────────────────────────────────────────────────

// Walk the tree and call fn(node, path). path is array of [parent, childIdx].
function visit(tree, fn, path = []) {
  fn(tree, path);
  if (tree.type === "split") {
    tree.children.forEach((c, i) => visit(c, fn, [...path, [tree, i]]));
  }
}

// Replace a node in the tree by id-matching predicate; returns a new tree.
// `transform(node)` may return a node (replacement) or null (remove + collapse).
function rebuild(tree, transform) {
  const out = transform(tree);
  if (out === null) return null;
  // If transform changed the node, keep it (don't recurse).
  if (out !== tree) return out;
  if (tree.type !== "split") return tree;
  const newChildren = [];
  const keptSizes = [];
  tree.children.forEach((c, i) => {
    const next = rebuild(c, transform);
    if (next !== null) {
      newChildren.push(next);
      keptSizes.push(tree.sizes?.[i] ?? 100 / tree.children.length);
    }
  });
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) {
    // Collapse single-child split into the child itself.
    return newChildren[0];
  }
  // Re-normalize sizes
  const total = keptSizes.reduce((a, b) => a + b, 0) || 1;
  const sizes = keptSizes.map((s) => (s / total) * 100);
  return { ...tree, children: newChildren, sizes };
}

function findGroupNode(tree, groupId) {
  let hit = null;
  visit(tree, (node) => {
    if (node.type === "group" && node.groupId === groupId) hit = node;
  });
  return hit;
}

// Find the parent split node + child index of the group leaf, if any.
function findParentOfGroup(tree, groupId) {
  let result = null;
  function recur(node, parent, idx) {
    if (node.type === "group" && node.groupId === groupId) {
      result = { parent, idx };
      return;
    }
    if (node.type === "split") {
      node.children.forEach((c, i) => recur(c, node, i));
    }
  }
  recur(tree, null, -1);
  return result;
}

// ── pure actions ────────────────────────────────────────────────────────

function setActiveTab(state, groupId, tabId) {
  const g = state.groups[groupId];
  if (!g) return state;
  return {
    ...state,
    activeGroupId: groupId,
    groups: { ...state.groups, [groupId]: { ...g, activeTabId: tabId } },
  };
}

function setActiveGroup(state, groupId) {
  if (!state.groups[groupId]) return state;
  return { ...state, activeGroupId: groupId };
}

function reorderTab(state, groupId, fromIdx, toIdx) {
  const g = state.groups[groupId];
  if (!g) return state;
  const tabs = g.tabs.slice();
  const [item] = tabs.splice(fromIdx, 1);
  const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
  tabs.splice(Math.max(0, Math.min(tabs.length, insertAt)), 0, item);
  return {
    ...state,
    groups: { ...state.groups, [groupId]: { ...g, tabs } },
  };
}

// Move a tab into a different group at targetIdx. If the source group becomes
// empty, it's removed and the layout tree collapses.
function moveTab(state, tabId, fromGroupId, toGroupId, targetIdx = null) {
  const fromG = state.groups[fromGroupId];
  const toG = state.groups[toGroupId];
  if (!fromG || !toG) return state;
  const fromIdx = fromG.tabs.findIndex((tb) => tb.id === tabId);
  if (fromIdx < 0) return state;

  if (fromGroupId === toGroupId) {
    if (targetIdx == null) return state;
    return reorderTab(state, fromGroupId, fromIdx, targetIdx);
  }

  const tab = fromG.tabs[fromIdx];
  const newFromTabs = fromG.tabs.filter((tb) => tb.id !== tabId);
  const newToTabs = toG.tabs.slice();
  const at = targetIdx == null ? newToTabs.length : Math.max(0, Math.min(newToTabs.length, targetIdx));
  newToTabs.splice(at, 0, tab);

  const groups = { ...state.groups };
  const next = { ...state };
  if (newFromTabs.length === 0) {
    // Remove the source group entirely.
    delete groups[fromGroupId];
    next.layoutTree = rebuild(state.layoutTree, (node) =>
      node.type === "group" && node.groupId === fromGroupId ? null : node
    );
    if (next.layoutTree == null) {
      // workspace must keep at least one group — restore a fresh empty one
      const emptyId = uid("g");
      groups[emptyId] = { id: emptyId, activeTabId: null, tabs: [] };
      next.layoutTree = { type: "group", groupId: emptyId };
      next.activeGroupId = emptyId;
    } else if (state.activeGroupId === fromGroupId) {
      next.activeGroupId = toGroupId;
    }
  } else {
    groups[fromGroupId] = {
      ...fromG,
      tabs: newFromTabs,
      activeTabId: fromG.activeTabId === tabId
        ? newFromTabs[Math.min(fromIdx, newFromTabs.length - 1)].id
        : fromG.activeTabId,
    };
  }
  groups[toGroupId] = { ...toG, tabs: newToTabs, activeTabId: tabId };
  next.groups = groups;
  next.activeGroupId = toGroupId;
  return next;
}

// Split a group into two. The new group is empty; if `movingTabId` is given,
// that tab moves from the source group into the new one. position is one of
// 'right' | 'left' | 'down' | 'up' — relative to `groupId`.
function splitGroup(state, groupId, position, movingTabId = null) {
  const newGroupId = uid("g");
  const sourceGroup = state.groups[groupId];
  if (!sourceGroup) return state;

  const direction = (position === "right" || position === "left") ? "horizontal" : "vertical";
  // `before` is true if the new group goes BEFORE the source in array order
  const before = position === "left" || position === "up";

  // Carve out the tab from source if moving
  let groups = { ...state.groups };
  let newTabs = [];
  if (movingTabId) {
    const tab = sourceGroup.tabs.find((tb) => tb.id === movingTabId);
    if (!tab) return state;
    const remaining = sourceGroup.tabs.filter((tb) => tb.id !== movingTabId);
    if (remaining.length === 0) {
      // Source group would become empty — that's a degenerate split. Just move active.
      // Better UX: bail (no-op) — caller should detect and use moveTab instead.
      return state;
    }
    groups[groupId] = {
      ...sourceGroup,
      tabs: remaining,
      activeTabId: sourceGroup.activeTabId === movingTabId
        ? remaining[0].id
        : sourceGroup.activeTabId,
    };
    newTabs = [tab];
  }

  const newGroup = {
    id: newGroupId,
    activeTabId: newTabs[0]?.id || null,
    tabs: newTabs,
  };
  groups[newGroupId] = newGroup;

  // Splice the new group beside the source in the tree
  const layoutTree = rebuild(state.layoutTree, (node) => {
    if (node.type !== "group" || node.groupId !== groupId) return node;
    const groupLeaf = { type: "group", groupId };
    const newLeaf = { type: "group", groupId: newGroupId };
    return {
      type: "split",
      direction,
      sizes: [50, 50],
      children: before ? [newLeaf, groupLeaf] : [groupLeaf, newLeaf],
    };
  });

  return {
    ...state,
    layoutTree,
    groups,
    activeGroupId: newGroupId,
  };
}

// Drop a tab onto an edge of `targetGroupId`. If the tab is from the same
// group AND the group has > 1 tab, split into a new group with that tab.
// Otherwise it's a regular cross-group move (since the source group will
// still exist or will be collapsed).
function dropTabOnEdge(state, srcTabId, srcGroupId, targetGroupId, position) {
  const srcG = state.groups[srcGroupId];
  if (!srcG) return state;
  const targetG = state.groups[targetGroupId];
  if (!targetG) return state;

  // Same group + dropping a tab from a single-tab group on its own edge → no-op
  if (srcGroupId === targetGroupId && srcG.tabs.length === 1) return state;

  // First create the new group adjacent to target, then move the tab in.
  // We can't use splitGroup(movingTabId) directly because the source might be
  // a DIFFERENT group from the split target.
  const newGroupId = uid("g");
  const direction = (position === "right" || position === "left") ? "horizontal" : "vertical";
  const before = position === "left" || position === "up";

  // Take the tab out of source
  const tab = srcG.tabs.find((tb) => tb.id === srcTabId);
  if (!tab) return state;
  const remaining = srcG.tabs.filter((tb) => tb.id !== srcTabId);

  let groups = { ...state.groups };
  groups[newGroupId] = { id: newGroupId, activeTabId: tab.id, tabs: [tab] };

  // Update source
  if (remaining.length === 0) {
    delete groups[srcGroupId];
  } else {
    groups[srcGroupId] = {
      ...srcG,
      tabs: remaining,
      activeTabId: srcG.activeTabId === srcTabId
        ? remaining[Math.min(srcG.tabs.findIndex((tb) => tb.id === srcTabId), remaining.length - 1)].id
        : srcG.activeTabId,
    };
  }

  // Tree: splice new group beside target
  let layoutTree = rebuild(state.layoutTree, (node) => {
    if (node.type !== "group" || node.groupId !== targetGroupId) return node;
    const targetLeaf = { type: "group", groupId: targetGroupId };
    const newLeaf = { type: "group", groupId: newGroupId };
    return {
      type: "split",
      direction,
      sizes: [50, 50],
      children: before ? [newLeaf, targetLeaf] : [targetLeaf, newLeaf],
    };
  });

  // If src was emptied, collapse it out of the tree
  if (remaining.length === 0) {
    layoutTree = rebuild(layoutTree, (node) =>
      node.type === "group" && node.groupId === srcGroupId ? null : node
    );
  }

  return {
    ...state,
    layoutTree,
    groups,
    activeGroupId: newGroupId,
  };
}

// Close a single tab. If it was the last in its group, remove the group
// (collapse the tree). Workspace must keep at least one (possibly empty) group.
function closeTab(state, groupId, tabId) {
  const g = state.groups[groupId];
  if (!g) return state;
  const idx = g.tabs.findIndex((tb) => tb.id === tabId);
  if (idx < 0) return state;
  const remaining = g.tabs.filter((tb) => tb.id !== tabId);
  const groups = { ...state.groups };

  if (remaining.length === 0) {
    delete groups[groupId];
    let layoutTree = rebuild(state.layoutTree, (node) =>
      node.type === "group" && node.groupId === groupId ? null : node
    );
    // Workspace must always have at least one group
    let activeGroupId = state.activeGroupId;
    if (layoutTree == null) {
      const emptyId = uid("g");
      groups[emptyId] = { id: emptyId, activeTabId: null, tabs: [] };
      layoutTree = { type: "group", groupId: emptyId };
      activeGroupId = emptyId;
    } else if (state.activeGroupId === groupId) {
      // pick the first surviving group
      const first = Object.keys(groups)[0];
      activeGroupId = first;
    }
    return { ...state, groups, layoutTree, activeGroupId };
  }

  // Pick a new active tab if we closed the active one
  const newActive = g.activeTabId === tabId
    ? remaining[Math.min(idx, remaining.length - 1)].id
    : g.activeTabId;
  groups[groupId] = { ...g, tabs: remaining, activeTabId: newActive };
  return { ...state, groups };
}

function closeOtherTabs(state, groupId, tabId) {
  const g = state.groups[groupId];
  if (!g) return state;
  const keep = g.tabs.find((tb) => tb.id === tabId);
  if (!keep) return state;
  return {
    ...state,
    groups: { ...state.groups, [groupId]: { ...g, tabs: [keep], activeTabId: keep.id } },
  };
}

function closeTabsToRight(state, groupId, tabId) {
  const g = state.groups[groupId];
  if (!g) return state;
  const idx = g.tabs.findIndex((tb) => tb.id === tabId);
  if (idx < 0) return state;
  const keep = g.tabs.slice(0, idx + 1);
  const wasActive = keep.find((tb) => tb.id === g.activeTabId)?.id || tabId;
  return {
    ...state,
    groups: { ...state.groups, [groupId]: { ...g, tabs: keep, activeTabId: wasActive } },
  };
}

function closeTabsToLeft(state, groupId, tabId) {
  const g = state.groups[groupId];
  if (!g) return state;
  const idx = g.tabs.findIndex((tb) => tb.id === tabId);
  if (idx < 0) return state;
  const keep = g.tabs.slice(idx);
  const wasActive = keep.find((tb) => tb.id === g.activeTabId)?.id || tabId;
  return {
    ...state,
    groups: { ...state.groups, [groupId]: { ...g, tabs: keep, activeTabId: wasActive } },
  };
}

function closeAllTabs(state, groupId) {
  const g = state.groups[groupId];
  if (!g) return state;
  // Close the group (will collapse layout)
  const groups = { ...state.groups };
  delete groups[groupId];
  let layoutTree = rebuild(state.layoutTree, (node) =>
    node.type === "group" && node.groupId === groupId ? null : node
  );
  let activeGroupId = state.activeGroupId;
  if (layoutTree == null) {
    const emptyId = uid("g");
    groups[emptyId] = { id: emptyId, activeTabId: null, tabs: [] };
    layoutTree = { type: "group", groupId: emptyId };
    activeGroupId = emptyId;
  } else if (state.activeGroupId === groupId) {
    activeGroupId = Object.keys(groups)[0];
  }
  return { ...state, groups, layoutTree, activeGroupId };
}

function openTab(state, groupId, tab) {
  const g = state.groups[groupId];
  if (!g) return state;
  const newTab = { id: uid("t"), title: "untitled", shell: "zsh", cwd: ".", status: "idle", cmd: null, lines: [], ...tab };
  return {
    ...state,
    groups: { ...state.groups, [groupId]: {
      ...g, tabs: [...g.tabs, newTab], activeTabId: newTab.id,
    }},
  };
}

function updateTab(state, tabId, updater) {
  let changed = false;
  const groups = {};
  for (const [groupId, group] of Object.entries(state.groups)) {
    let groupChanged = false;
    const tabs = group.tabs.map((tab) => {
      if (tab.id !== tabId) return tab;
      const next = typeof updater === "function" ? updater(tab, group) : { ...tab, ...updater };
      groupChanged = next !== tab;
      changed = changed || groupChanged;
      return next;
    });
    groups[groupId] = groupChanged ? { ...group, tabs } : group;
  }

  return changed ? { ...state, groups } : state;
}

// openFile — open a file as an editor tab in the active group.
// If a tab already exists for that path (in any group), focus it instead.
function openFile(state, groupId, fileTab) {
  // Look for existing editor tab matching this path
  for (const g of Object.values(state.groups)) {
    const hit = g.tabs.find((tb) => tb.type === "editor" && tb.path === fileTab.path);
    if (hit) {
      return {
        ...state,
        activeGroupId: g.id,
        groups: { ...state.groups, [g.id]: { ...g, activeTabId: hit.id } },
      };
    }
  }
  // Otherwise open new in target group
  const g = state.groups[groupId] || Object.values(state.groups)[0];
  if (!g) return state;
  const newTab = { ...fileTab, id: fileTab.id || uid("ed") };
  return {
    ...state,
    activeGroupId: g.id,
    groups: { ...state.groups, [g.id]: {
      ...g, tabs: [...g.tabs, newTab], activeTabId: newTab.id,
    }},
  };
}

// Move a tab to a new group in `position` ('right' | 'left' | 'down' | 'up')
function moveTabToNewGroup(state, srcGroupId, tabId, position) {
  const src = state.groups[srcGroupId];
  if (!src) return state;
  if (src.tabs.length <= 1) return state; // need to leave at least one tab in src
  return dropTabOnEdge(state, tabId, srcGroupId, srcGroupId, position);
}

// Resize a split node's children sizes. We find the split that is the parent
// of `firstChildId` (so the divider lives between firstChild and its right
// neighbor) and apply the new ratio.
function resizeSplit(state, splitPath, sizes) {
  // splitPath is the array of "L"/"R"/i indices to identify the split.
  // Simpler approach: we identify the split node by reference walk during
  // rebuild; the SplitNode component knows the array of sizes and passes them.
  // For prototype we rebuild every split whose children match the recorded ids.
  const layoutTree = rebuild(state.layoutTree, (node) => {
    if (node.type !== "split") return node;
    if (!node.children.every((c, i) => splitPath[i] && c.type === splitPath[i].type &&
        (c.type === "group" ? c.groupId === splitPath[i].groupId : true))) return node;
    return { ...node, sizes };
  });
  return { ...state, layoutTree };
}

Object.assign(window, {
  uid,
  // pure tree utils
  visit, rebuild, findGroupNode, findParentOfGroup,
  // actions
  setActiveTab, setActiveGroup,
  reorderTab, moveTab, moveTabToNewGroup,
  splitGroup, dropTabOnEdge,
  closeTab, closeOtherTabs, closeTabsToRight, closeTabsToLeft, closeAllTabs,
  openTab, updateTab, resizeSplit, openFile,
});


// ----- src/sidebar.jsx -----
// sidebar.jsx — VS Code-style two-section accordion:
//   1. Projects (current + recents, branch/path inline)
//   2. Files (file tree of the active project)
// Each section header is a clickable toggle; sections collapse independently.

function FileTreeNode({ node, depth, lang, onSelect, selected }) {
  const [open, setOpen] = React.useState(node.open !== false);
  const isDir = node.type === "dir";
  const isSelected = (selected === node.name || selected === node.runtimePath) && !isDir;
  return (
    <>
      <div
        className={"tree-row " + (isDir ? "dir" : "file") + (isSelected || node.selected ? " selected" : "")}
        style={{ paddingLeft: 10 + depth * 12 }}
        onClick={() => {
          if (isDir) setOpen(!open);
          else onSelect?.(node);
        }}
      >
        {isDir
          ? <span className="chev">{open ? <Icon.chevronDown /> : <Icon.chevron />}</span>
          : <span className="chev" />}
        <span className="ico">{isDir ? <Icon.folder /> : <Icon.file />}</span>
        <span className="nm">{node.name}</span>
        {node.changed && <span className="dot-changed" />}
      </div>
      {isDir && open && node.children?.map((c, i) =>
        <FileTreeNode key={i} node={c} depth={depth + 1} lang={lang} onSelect={onSelect} selected={selected} />
      )}
    </>
  );
}

// Collapsible accordion section — VS Code style header with chevron.
function Section({ label, count, open, onToggle, children }) {
  return (
    <div className={"sb-section" + (open ? " open" : " closed")}>
      <button className="sb-section-h" onClick={onToggle}>
        <span className="sb-chev">{open ? <Icon.chevronDown /> : <Icon.chevron />}</span>
        <span className="sb-section-label">{label}</span>
        {count != null && <span className="count">{count}</span>}
      </button>
      {open && <div className="sb-section-body">{children}</div>}
    </div>
  );
}

// Recent-project list. For the prototype, items beside the active one are
// placeholders — clicking is non-destructive (we don't actually swap the
// workspace), but UX shows hover/active states.
const RECENT_PROJECTS = [
  { id: "klystron", name: "klystron-cli",  path: "~/code/klystron-cli",  branch: "main",                changedFiles: 0, ahead: 0, behind: 1 },
  { id: "harbor",   name: "harbor-mobile", path: "~/code/harbor-mobile", branch: "release/v2.3",        changedFiles: 2, ahead: 0, behind: 0 },
  { id: "lumen",    name: "lumen-edge",    path: "~/code/lumen-edge",    branch: "feature/qos-shaping", changedFiles: 5, ahead: 1, behind: 0 },
];

function ProjectItem({ project, active, lang, onSelect }) {
  return (
    <button
      className={"project-item" + (active ? " active" : "")}
      onClick={() => onSelect?.(project)}
    >
      <span className={"project-mark" + (active ? " active" : "")}>
        {(project.name || "?")[0].toUpperCase()}
      </span>
      <span className="project-info">
        <span className="project-name">
          <span className="nm">{project.name}</span>
          {active && (
            <span className="project-tag">{lang === "ko" ? "현재" : "current"}</span>
          )}
        </span>
        <span className="project-meta">
          <Icon.branch />
          <span className="project-branch">{project.branch}</span>
          {project.changedFiles > 0 && (
            <>
              <span className="project-meta-sep">·</span>
              <span className="project-changes">
                {project.changedFiles} {lang === "ko" ? "변경" : "changes"}
              </span>
            </>
          )}
          {(project.ahead > 0 || project.behind > 0) && (
            <>
              <span className="project-meta-sep">·</span>
              <span className="project-ahead">↑{project.ahead} ↓{project.behind}</span>
            </>
          )}
        </span>
      </span>
    </button>
  );
}

function Sidebar({ lang, project, openingProject, collapseSidebar, onOpenFile, onOpenProject }) {
  const [selectedFile, setSelectedFile] = React.useState("OnboardingFunnel.tsx");
  const [projectsOpen, setProjectsOpen] = React.useState(true);
  const [filesOpen, setFilesOpen] = React.useState(true);
  const activeProject = project || PROJECT;

  const handleFileClick = (node) => {
    const path = node.runtimePath || pathOfNode(activeProject.fileTree, node);
    if (path) onOpenFile?.(path, node.name);
    setSelectedFile(node.runtimePath || node.name);
  };

  return (
    <aside className="sidebar">
      <div className="sb-titlebar">
        <span className="sb-title">{lang === "ko" ? "탐색기" : "Explorer"}</span>
        <button
          className="rail-toggle"
          onClick={collapseSidebar}
          title={t(lang, "collapseSidebar")}
        >
          <Icon.panelLeft />
        </button>
      </div>

      <div className="sb-scroll">
        <Section
          label={lang === "ko" ? "프로젝트" : "Projects"}
          count={1 + RECENT_PROJECTS.length}
          open={projectsOpen}
          onToggle={() => setProjectsOpen((v) => !v)}
        >
          <div className="project-list">
            <ProjectItem
              project={activeProject}
              active
              lang={lang}
              onSelect={() => {}}
            />
            {RECENT_PROJECTS.map((p) => (
              <ProjectItem
                key={p.id}
                project={p}
                active={false}
                lang={lang}
                onSelect={() => {}}
              />
            ))}
            <button className="project-item action" onClick={onOpenProject} disabled={openingProject}>
              <span className="project-mark plus"><Icon.plus /></span>
              <span className="project-info">
                <span className="project-name">
                  <span className="nm">{t(lang, "openProjectFolder")}</span>
                </span>
                <span className="project-meta">
                  {openingProject
                    ? (lang === "ko" ? "프로젝트를 여는 중" : "Opening project")
                    : (lang === "ko" ? "로컬 폴더를 워크스페이스로 열기" : "Open a local folder as a workspace")}
                </span>
              </span>
              <span className="kbd">⌘O</span>
            </button>
          </div>
        </Section>

        <Section
          label={lang === "ko" ? "파일" : "Files"}
          count={activeProject.changedFiles > 0
            ? `${activeProject.changedFiles} ${lang === "ko" ? "변경" : "changed"}`
            : null}
          open={filesOpen}
          onToggle={() => setFilesOpen((v) => !v)}
        >
          {activeProject.fileTree.map((n, i) =>
            <FileTreeNode key={i} node={n} depth={0} lang={lang}
              onSelect={handleFileClick}
              selected={selectedFile} />
          )}
        </Section>
      </div>
    </aside>
  );
}

Object.assign(window, { Sidebar });


// ----- src/workspace.jsx -----
// workspace.jsx — VS Code-style workspace UI.
// Renders the layout tree, each leaf is a Group (own tabbar + content),
// each split is a SplitNode (children + drag-resize divider).

const DROP_EDGE_RATIO = 0.18; // top/right/bottom/left ~ 18% wide each
const MIN_PANE_PCT = 8;       // minimum % of a child after resizing

// ── Code editor view ────────────────────────────────────────────────────
function CodeEditor({ tab }) {
  const lines = (tab.content || "").split("\n");
  return (
    <div className="editor-body">
      <div className="editor-gutter">
        {lines.map((_, i) => (
          <div key={i} className="editor-ln">{i + 1}</div>
        ))}
      </div>
      <div className="editor-code">
        {lines.map((line, i) => (
          <div key={i} className="editor-line">
            {tokenizeLine(line).map((tok, j) => (
              <span key={j} className={"tk-" + tok.k}>{tok.t}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab body ────────────────────────────────────────────────────────────
function TabBody({ tab }) {
  if (!tab) return null;
  if (tab.type === "editor") return <CodeEditor tab={tab} />;
  return <TerminalBody tab={tab} />;
}

function TerminalBody({ tab }) {
  const bodyRef = React.useRef(null);
  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [tab?.id, tab?.lines?.length]);
  return (
    <div className="tab-body" ref={bodyRef}>
      {tab.lines.map((ln, i) => (
        <div key={i} className={"term-line " + (ln.kind === "cmd" ? "cmd" : (ln.color || ""))}>
          {ln.text}
        </div>
      ))}
      {tab.status === "running" && <div className="term-line"><span className="term-cursor" /></div>}
      {tab.status === "idle" && (
        <div className="term-line">
          <span style={{ color: "var(--accent)" }}>$</span> <span className="term-cursor" />
        </div>
      )}
    </div>
  );
}

// ── Empty group placeholder ─────────────────────────────────────────────
function EmptyGroup({ lang, onNewTab }) {
  return (
    <div className="empty-group">
      <div className="empty-card">
        <div className="empty-title">{t(lang, "emptyGroup")}</div>
        <button className="btn btn-secondary" onClick={onNewTab}>
          <Icon.plus />
          <span>{t(lang, "newTabHere")}</span>
        </button>
      </div>
    </div>
  );
}

// ── Right-click context menu ────────────────────────────────────────────
function TabContextMenu({ lang, tab, group, position, onAction, onClose }) {
  React.useEffect(() => {
    const onDoc = (e) => { if (!e.target.closest(".tab-ctx-menu")) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const idx = group.tabs.findIndex((tb) => tb.id === tab.id);
  const hasRight = idx >= 0 && idx < group.tabs.length - 1;
  const hasLeft  = idx > 0;
  const hasOthers = group.tabs.length > 1;
  const items = [
    { id: "close", label: t(lang, "ctxClose") },
    { id: "closeOthers", label: t(lang, "ctxCloseOthers"), disabled: !hasOthers },
    { id: "closeRight",  label: t(lang, "ctxCloseRight"),  disabled: !hasRight },
    { id: "closeLeft",   label: t(lang, "ctxCloseLeft"),   disabled: !hasLeft },
    { id: "closeAll",    label: t(lang, "ctxCloseAll") },
    "divider",
    { id: "splitRight", label: t(lang, "ctxSplitRight") },
    { id: "splitDown",  label: t(lang, "ctxSplitDown") },
    { id: "splitLeft",  label: t(lang, "ctxSplitLeft") },
    { id: "splitUp",    label: t(lang, "ctxSplitUp") },
    "divider",
    { id: "moveRight",  label: t(lang, "ctxMoveRight"), disabled: !hasOthers },
    { id: "moveDown",   label: t(lang, "ctxMoveDown"),  disabled: !hasOthers },
  ];
  return (
    <div className="tab-ctx-menu" style={{ left: position.x, top: position.y }}
         onMouseDown={(e) => e.stopPropagation()}>
      {items.map((it, i) => it === "divider"
        ? <div className="ctx-divider" key={"d" + i} />
        : (
          <button
            key={it.id}
            className={"ctx-item" + (it.disabled ? " disabled" : "")}
            disabled={it.disabled}
            onClick={() => { onAction(it.id); onClose(); }}
          >{it.label}</button>
        ))}
    </div>
  );
}

// ── Group tabbar ────────────────────────────────────────────────────────
function GroupTabBar({
  group, isActiveGroup, lang,
  onSetActiveTab, onCloseTab, onNewTab,
  onReorderTab, onDropTabFromAnother,
  onTabContextMenu,
  dragRef, onTabDragStart, onTabDragEnd,
}) {
  const barRef = React.useRef(null);
  const [dropAt, setDropAt] = React.useState(null);

  const computeDropAt = (clientX) => {
    if (!barRef.current) return null;
    const tabEls = [...barRef.current.querySelectorAll(".gt[data-tab-id]")];
    for (let i = 0; i < tabEls.length; i++) {
      const r = tabEls[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) return i;
    }
    return tabEls.length;
  };

  const onDragOver = (e) => {
    if (!dragRef) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.dataTransfer.dropEffect = "move"; } catch {}
    setDropAt(computeDropAt(e.clientX));
  };
  const onDragLeave = (e) => {
    if (!barRef.current?.contains(e.relatedTarget)) setDropAt(null);
  };
  const onDrop = (e) => {
    if (!dragRef) return;
    e.preventDefault();
    e.stopPropagation();
    const at = computeDropAt(e.clientX) ?? group.tabs.length;
    if (dragRef.groupId === group.id) onReorderTab(dragRef.tabId, at);
    else onDropTabFromAnother(dragRef, group.id, at);
    setDropAt(null);
  };

  return (
    <div
      className={"group-tabbar" + (isActiveGroup ? " active" : "")}
      ref={barRef}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {group.tabs.map((tb, i) => (
        <React.Fragment key={tb.id}>
          {dropAt === i && <span className="gt-drop-indicator" aria-hidden />}
          <div
            data-tab-id={tb.id}
            className={"gt" + (tb.id === group.activeTabId ? " active" : "")}
            draggable
            onDragStart={(e) => {
              try { e.dataTransfer.effectAllowed = "move"; } catch {}
              try { e.dataTransfer.setData("text/plain", "tab:" + tb.id); } catch {}
              e.currentTarget.classList.add("dragging");
              onTabDragStart(group.id, tb.id);
            }}
            onDragEnd={(e) => {
              e.currentTarget.classList.remove("dragging");
              onTabDragEnd();
            }}
            onClick={() => onSetActiveTab(group.id, tb.id)}
            onContextMenu={(e) => { e.preventDefault(); onTabContextMenu(e, group, tb); }}
          >
            <span className={"lamp " + tb.status} />
            <span className="ttl">{tb.title}</span>
            <button
              className="x-btn"
              onClick={(e) => { e.stopPropagation(); onCloseTab(group.id, tb.id); }}
              title={t(lang, "closeTab")}
            ><Icon.x /></button>
          </div>
        </React.Fragment>
      ))}
      {dropAt === group.tabs.length && <span className="gt-drop-indicator" aria-hidden />}
      <button
        className="gt-add"
        onClick={() => onNewTab(group.id)}
        title={t(lang, "newTab")}
      ><Icon.plus /></button>
      <div className="gt-fill" />
    </div>
  );
}

// ── Group (tabbar + content area) ───────────────────────────────────────
function Group({
  group, isActive, lang, executing, project,
  onSetActiveTab, onCloseTab, onNewTab,
  onReorderTab, onDropTabFromAnother, onDropTabOnEdge,
  onTabContextMenu, onFocusGroup,
  dragRef, onTabDragStart, onTabDragEnd,
}) {
  const contentRef = React.useRef(null);
  const [edge, setEdge] = React.useState(null);
  const activeProject = project || PROJECT;

  // Edge detection: figure out if pointer is near a side of the content area.
  // Returns 'left' | 'right' | 'top' | 'bottom' | 'center' (move-into-tabbar).
  const detectEdge = (e) => {
    const el = contentRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (x < DROP_EDGE_RATIO) return "left";
    if (x > 1 - DROP_EDGE_RATIO) return "right";
    if (y < DROP_EDGE_RATIO) return "top";
    if (y > 1 - DROP_EDGE_RATIO) return "bottom";
    return "center";
  };

  const onDragOver = (e) => {
    if (!dragRef) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = "move"; } catch {}
    const d = detectEdge(e);
    if (d !== edge) setEdge(d);
  };
  const onDragLeave = (e) => {
    if (!contentRef.current?.contains(e.relatedTarget)) setEdge(null);
  };
  const onDrop = (e) => {
    if (!dragRef) return;
    e.preventDefault();
    e.stopPropagation();
    const d = detectEdge(e);
    setEdge(null);
    if (!d) return;
    if (d === "center") {
      // Drop into tabbar (append). If same group, no-op (already there).
      if (dragRef.groupId !== group.id) {
        onDropTabFromAnother(dragRef, group.id, group.tabs.length);
      }
    } else {
      onDropTabOnEdge(dragRef, group.id, d);
    }
  };

  const activeTab = group.tabs.find((tb) => tb.id === group.activeTabId) || group.tabs[0] || null;

  return (
    <div
      className={"group" + (isActive ? " active" : "")}
      onMouseDown={() => onFocusGroup(group.id)}
    >
      <GroupTabBar
        group={group}
        isActiveGroup={isActive}
        lang={lang}
        onSetActiveTab={onSetActiveTab}
        onCloseTab={onCloseTab}
        onNewTab={onNewTab}
        onReorderTab={(tabId, at) => onReorderTab(group.id, tabId, at)}
        onDropTabFromAnother={onDropTabFromAnother}
        onTabContextMenu={onTabContextMenu}
        dragRef={dragRef}
        onTabDragStart={onTabDragStart}
        onTabDragEnd={onTabDragEnd}
      />
      <div
        className="group-content"
        ref={contentRef}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {activeTab ? (
          <>
            {activeTab.type !== "editor" && (
              <div className="group-status">
                <span className="cwd">
                  {activeTab.cwd === "." ? activeProject.path : `${activeProject.path}/${activeTab.cwd}`}
                </span>
                <span className="sep">·</span>
                <span className="cmd">{activeTab.cmd || "—"}</span>
                <span className={"badge " + activeTab.status}>{t(lang, activeTab.status)}</span>
              </div>
            )}
            {activeTab.type === "editor" && (
              <div className="group-status editor-status">
                <span className="cwd">{activeTab.displayPath || activeTab.path}</span>
                {activeTab.dirty && <span className="dirty-dot" />}
                <span className="sep">·</span>
                <span className="cmd">{activeTab.lang}</span>
              </div>
            )}
            <TabBody tab={activeTab} />
          </>
        ) : (
          <EmptyGroup lang={lang} onNewTab={() => onNewTab(group.id)} />
        )}
        {executing && isActive && (
          <div className="run-banner">
            <span className="spin" />
            <span>{t(lang, "nowExecuting")}</span>
            <span style={{ color: "var(--text-dim)" }}>· {executing}</span>
          </div>
        )}
        {edge && (
          <div className="group-drop-overlay" aria-hidden>
            <div className={"group-drop-zone " + edge} />
            {edge !== "center" && (
              <div className="group-drop-label">
                {lang === "ko"
                  ? `${({left:"왼쪽",right:"오른쪽",top:"위",bottom:"아래"})[edge]}에 새 그룹`
                  : `Split ${edge}`}
              </div>
            )}
            {edge === "center" && (
              <div className="group-drop-label center">
                {lang === "ko" ? "이 그룹에 추가" : "Add to this group"}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Split node ──────────────────────────────────────────────────────────
function SplitNode({
  node, onResizeSizes, ...groupProps
}) {
  const containerRef = React.useRef(null);
  const isRow = node.direction === "horizontal";
  const dragRef = React.useRef(null);
  // Local sizes that the drag updates in real time, but we commit on dragend
  // to avoid spamming the parent state during the drag.
  const [localSizes, setLocalSizes] = React.useState(null);
  const sizes = localSizes || node.sizes || node.children.map(() => 100 / node.children.length);

  const onDividerMouseDown = (i) => (e) => {
    e.preventDefault();
    const containerRect = containerRef.current.getBoundingClientRect();
    const totalPx = isRow ? containerRect.width : containerRect.height;
    const start = isRow ? e.clientX : e.clientY;
    const startSizes = sizes.slice();
    dragRef.current = { i, totalPx, start, startSizes };

    const onMove = (ev) => {
      const cur = isRow ? ev.clientX : ev.clientY;
      const dPx = cur - dragRef.current.start;
      const dPct = (dPx / dragRef.current.totalPx) * 100;
      const next = dragRef.current.startSizes.slice();
      const idx = dragRef.current.i;
      next[idx] = Math.max(MIN_PANE_PCT, Math.min(100 - MIN_PANE_PCT, next[idx] + dPct));
      next[idx + 1] = Math.max(MIN_PANE_PCT, Math.min(100 - MIN_PANE_PCT,
        next[idx + 1] - dPct));
      setLocalSizes(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Keep localSizes — clearing it would revert to node.sizes (the initial value)
      // which makes the resize feel like it doesn't stick.
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={containerRef}
      className={"split " + (isRow ? "row" : "col")}
    >
      {node.children.map((child, i) => (
        <React.Fragment key={i}>
          <div
            className="split-cell"
            style={{ flexBasis: sizes[i] + "%", flexGrow: 0, flexShrink: 0, minWidth: 0, minHeight: 0 }}
          >
            <LayoutNode node={child} {...groupProps} />
          </div>
          {i < node.children.length - 1 && (
            <div
              className={"split-divider " + (isRow ? "vert" : "horz")}
              onMouseDown={onDividerMouseDown(i)}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Layout node dispatcher ──────────────────────────────────────────────
function LayoutNode({ node, workspace, ...rest }) {
  if (node.type === "group") {
    const group = workspace.groups[node.groupId];
    if (!group) return null;
    return <Group
      group={group}
      isActive={workspace.activeGroupId === group.id}
      {...rest}
    />;
  }
  return <SplitNode node={node} workspace={workspace} {...rest} />;
}

// ── Workspace root ──────────────────────────────────────────────────────
function Workspace({
  workspace, lang, executing, project,
  sidebarOpen, openSidebar, agentOpen, openAgent,
  actions,
}) {
  const [dragRef, setDragRef] = React.useState(null);
  const [ctxMenu, setCtxMenu] = React.useState(null);

  const onTabContextMenu = (e, group, tab) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, group, tab });
  };
  const onCtxAction = (action) => {
    const { group, tab } = ctxMenu;
    switch (action) {
      case "close":        actions.closeTab(group.id, tab.id); break;
      case "closeOthers":  actions.closeOtherTabs(group.id, tab.id); break;
      case "closeRight":   actions.closeTabsToRight(group.id, tab.id); break;
      case "closeLeft":    actions.closeTabsToLeft(group.id, tab.id); break;
      case "closeAll":     actions.closeAllTabs(group.id); break;
      case "splitRight":   actions.splitGroup(group.id, "right"); break;
      case "splitDown":    actions.splitGroup(group.id, "down"); break;
      case "splitLeft":    actions.splitGroup(group.id, "left"); break;
      case "splitUp":      actions.splitGroup(group.id, "up"); break;
      case "moveRight":    actions.moveTabToNewGroup(group.id, tab.id, "right"); break;
      case "moveDown":     actions.moveTabToNewGroup(group.id, tab.id, "down"); break;
    }
  };

  const groupProps = {
    workspace,
    lang,
    executing,
    project,
    dragRef,
    onTabDragStart: (groupId, tabId) => setDragRef({ groupId, tabId }),
    onTabDragEnd: () => setDragRef(null),
    onSetActiveTab: actions.setActiveTab,
    onCloseTab: actions.closeTab,
    onNewTab: actions.newTab,
    onReorderTab: actions.reorderTab,
    onDropTabFromAnother: (src, toGroupId, idx) => actions.moveTab(src.tabId, src.groupId, toGroupId, idx),
    onDropTabOnEdge: (src, targetGroupId, position) => actions.dropTabOnEdge(src.tabId, src.groupId, targetGroupId, position),
    onFocusGroup: actions.setActiveGroup,
    onTabContextMenu,
    onResizeSizes: (sizes) => { /* sizes persisted via local state for now */ },
  };

  return (
    <main className="center">
      {!sidebarOpen && (
        <button className="ws-rail-btn ws-rail-left"
          onClick={openSidebar}
          title={t(lang, "expandSidebar")}>
          <Icon.panelLeft />
        </button>
      )}
      <div className="workspace-root">
        <LayoutNode node={workspace.layoutTree} {...groupProps} />
      </div>
      {!agentOpen && (
        <button className="ws-rail-btn ws-rail-right" onClick={openAgent}
          title={t(lang, "expandAgent")}>
          <Icon.panelRight />
        </button>
      )}
      {ctxMenu && (
        <TabContextMenu
          lang={lang}
          tab={ctxMenu.tab}
          group={ctxMenu.group}
          position={{ x: ctxMenu.x, y: ctxMenu.y }}
          onAction={onCtxAction}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </main>
  );
}

Object.assign(window, { Workspace });


// ----- src/agent.jsx -----
// agent.jsx — right pane: chat-centric agent panel

function ModePill({ mode, setMode, lang }) {
  return (
    <div className="mode-pill">
      {["fast", "balanced", "deep"].map((m) => (
        <button
          key={m}
          className={mode === m ? "active" : ""}
          onClick={() => setMode(m)}
        >
          {t(lang, m)}
        </button>
      ))}
    </div>
  );
}

function ContextSummary({ lang, activeTab, activePane, project }) {
  const activeProject = project || PROJECT;
  const contextFiles = activeTab?.type === "editor"
    ? activeTab.displayPath || activeTab.path
    : "OnboardingFunnel.tsx, useFunnelState.ts";
  return (
    <div className="context-summary">
      <div className="h">{t(lang, "aboutContext")}</div>
      <div className="row">
        <span className="k">{t(lang, "contextFiles")}:</span>
        <span className="v">{contextFiles}</span>
      </div>
      <div className="row">
        <span className="k">{t(lang, "contextTab")}:</span>
        <span className="v">[{activeTab.title}] {activePane.lines.length} {lang === "ko" ? "줄" : "lines"}</span>
      </div>
      <div className="row">
        <span className="k">{t(lang, "branch")}:</span>
        <span className="v">{activeProject.branch}</span>
      </div>
    </div>
  );
}

function MessageBubble({ msg, lang, activeTab, onOpenApproval }) {
  if (msg.role === "user") {
    return (
      <div className="msg user">
        <div className="msg-meta">
          <span>{msg.at}</span>
          <span className="role-tag user">{t(lang, "you")}</span>
        </div>
        <div className="msg-bubble">{msg.content}</div>
        {msg.contextAttached && (
          <div className="ctx-attach">
            <span className="clip" />
            <span>{lang === "ko" ? "첨부됨:" : "Attached:"} [{msg.contextAttached[0].replace("t-", "")}]</span>
          </div>
        )}
      </div>
    );
  }

  if (msg.suggestion) {
    const s = msg.suggestion;
    return (
      <div className="msg assistant">
        <div className="msg-meta">
          <span>{msg.at}</span>
          <span className="role-tag assistant">
            {t(lang, "conductor")}
          </span>
          <span>· {t(lang, "suggestedActions")}</span>
        </div>
        <div className="sugg">
          <div className="sugg-h">
            <span className="icon"><Icon.spark /></span>
            <span>{s.title}</span>
            <span className="need">{t(lang, "needsApproval")}</span>
          </div>
          <div className="sugg-cmds">
            {s.commands.map((c, i) => (
              <div className="sugg-cmd" key={i}>
                <span style={{ color: "var(--accent)", flexShrink: 0 }}>$</span>
                <span className="cmd-text">{c.cmd}</span>
                <span className={"risk " + c.risk}>{t(lang, "risk" + c.risk[0].toUpperCase() + c.risk.slice(1))}</span>
                <span className="target">
                  {c.target === "new" ? (lang === "ko" ? "새 탭" : "new tab") : `[${c.target.replace("t-", "")}]`}
                </span>
              </div>
            ))}
          </div>
          <div className="sugg-note">{s.note}</div>
          <div className="sugg-actions">
            <button className="btn btn-primary" onClick={() => onOpenApproval(s)}>
              <Icon.shield /> {t(lang, "review")}
            </button>
            <button className="btn btn-ghost">{t(lang, "deny")}</button>
          </div>
        </div>
      </div>
    );
  }

  if (msg.completed) {
    return (
      <div className="msg assistant">
        <div className="msg-meta">
          <span>{msg.at}</span>
          <span className="role-tag assistant">{t(lang, "operator")}</span>
        </div>
        <div className={"completed-card" + (msg.autoRan ? " auto-ran" : "")}>
          <div className="ttl">
            <Icon.dot /> {t(lang, "completed")}
            {msg.autoRan && (
              <span className="auto-ran-tag">{t(lang, "autoRanInline")}</span>
            )}
          </div>
          <div>{msg.completed.summary}</div>
          <div className="cmds">
            {msg.completed.commands.map((c, i) => (
              <div key={i}>$ {c}</div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg assistant">
      <div className="msg-meta">
        <span>{msg.at}</span>
        {msg.roleLabel && <span className="role-tag assistant">{msg.roleLabel}</span>}
      </div>
      <div className="msg-bubble" dangerouslySetInnerHTML={{ __html: renderInline(msg.content) }} />
    </div>
  );
}

function renderInline(s) {
  // very small backtick-code renderer
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function TypingIndicator({ lang }) {
  return (
    <div className="msg assistant">
      <div className="msg-meta">
        <span className="role-tag assistant">{t(lang, "assistant")}</span>
        <span>· {t(lang, "typing")}</span>
      </div>
      <div className="typing">
        <span className="blob" />
        <span className="blob" />
        <span className="blob" />
      </div>
    </div>
  );
}

function Composer({ lang, activeTab, onSend, mode, setMode }) {
  const [val, setVal] = React.useState("");
  const ref = React.useRef(null);
  const submit = () => {
    const v = val.trim();
    if (!v) return;
    onSend(v);
    setVal("");
    if (ref.current) ref.current.style.height = "auto";
  };
  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  const onInput = (e) => {
    setVal(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(120, e.target.scrollHeight) + "px";
  };

  const quickPrompts = [
    t(lang, "explain"),
    t(lang, "suggestFix"),
    t(lang, "rerunTests"),
  ];

  return (
    <div className="composer">
      <div className="composer-quick">
        {quickPrompts.map((q, i) => (
          <button key={i} className="qchip" onClick={() => onSend(q)}>
            <Icon.spark /> {q}
          </button>
        ))}
      </div>
      <div className="composer-input">
        <textarea
          ref={ref}
          value={val}
          onChange={onInput}
          onKeyDown={onKey}
          placeholder={t(lang, "typeMessage")}
          rows={1}
        />
        <div className="composer-foot">
          <span className="ctx-tag">
            <span className="clip" />
            [{activeTab.title}] · {t(lang, "sendCtx")}
          </span>
          <ModePill mode={mode} setMode={setMode} lang={lang} />
          <button className="send" onClick={submit} disabled={!val.trim()}>
            <Icon.send />
          </button>
        </div>
      </div>
    </div>
  );
}

function ModelPicker({ lang, providers, activeProviderId, activeModelId, onChange }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const activeModel = activeProvider?.models.find((m) => m.id === activeModelId);
  const label = activeModel ? activeModel.label.replace("Claude ", "").replace("GPT-", "GPT-") : t(lang, "pickModel");

  return (
    <div className="model-picker" ref={ref}>
      <button className="model-picker-btn" onClick={() => setOpen((v) => !v)}>
        <Icon.spark />
        <span className="ttl">{label}</span>
        <Icon.chevronDown style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <div className="model-picker-menu">
          {providers.filter((p) => p.state === "connected").map((p) => (
            <React.Fragment key={p.id}>
              <div className="model-picker-group-label">
                <div className={"provider-mark " + p.id} style={{ width: 18, height: 18, fontSize: 9 }}>{p.abbr}</div>
                {p.label}
              </div>
              {p.models.map((m) => (
                <button
                  key={m.id}
                  className={"model-picker-item" + (p.id === activeProviderId && m.id === activeModelId ? " active" : "")}
                  onClick={() => { onChange(p.id, m.id); setOpen(false); }}
                >
                  <span className="model-picker-name">{m.label}</span>
                  <span className={"model-picker-tier " + m.tier}>{t(lang, m.tier)}</span>
                </button>
              ))}
            </React.Fragment>
          ))}
          {providers.filter((p) => p.state === "connected").length === 0 && (
            <div className="model-picker-empty">
              {t(lang, "noConnectedProviders")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentPanel({
  lang, messages, isTyping, activeTab, activePane, mode, setMode,
  onSend, onOpenApproval, providers, collapseAgent,
  activeProviderId, activeModelId, onSwitchModel, onOpenSettings, project,
}) {
  const chatRef = React.useRef(null);
  React.useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages.length, isTyping]);

  const active = providers.find((p) => p.id === activeProviderId) || providers.find((p) => p.state === "connected") || providers[0];

  return (
    <aside className="agent">
      <div className="agent-header">
        <div className={"provider-mark " + active.id} style={{ width: 32, height: 32, fontSize: 12 }}>
          {active.abbr}
        </div>
        <div className="who">
          <div className="nm">
            {t(lang, "agentChat")}
            <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
              · {active.label}
            </span>
          </div>
          <div className="sub">
            {lang === "ko" ? "지휘자 + 4 워커 · " : "Conductor + 4 workers · "}
            {t(lang, mode)}
          </div>
        </div>
        <button
          className="rail-toggle"
          onClick={onOpenSettings}
          title={t(lang, "settingsTitle")}
        >
          <Icon.gear />
        </button>
        <button
          className="rail-toggle"
          onClick={collapseAgent}
          title={t(lang, "collapseAgent")}
        >
          <Icon.panelRight />
        </button>
      </div>

      <div className="agent-model-row">
        <ModelPicker
          lang={lang}
          providers={providers}
          activeProviderId={activeProviderId}
          activeModelId={activeModelId}
          onChange={onSwitchModel}
        />
        <ModePill mode={mode} setMode={setMode} lang={lang} />
      </div>

      <ContextSummary lang={lang} activeTab={activeTab} activePane={activePane} project={project} />

      <div className="chat" ref={chatRef}>
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            lang={lang}
            activeTab={activeTab}
            onOpenApproval={onOpenApproval}
          />
        ))}
        {isTyping && <TypingIndicator lang={lang} />}
      </div>

      <Composer
        lang={lang}
        activeTab={activeTab}
        onSend={onSend}
        mode={mode}
        setMode={setMode}
      />
    </aside>
  );
}

Object.assign(window, { AgentPanel });


// ----- src/modals.jsx -----
// modals.jsx — approval + OAuth provider connect

function ApprovalModal({ lang, suggestion, onClose, onApprove, tabs, project }) {
  if (!suggestion) return null;
  const activeProject = project || PROJECT;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-ico">
            <Icon.shield />
          </div>
          <div>
            <div className="modal-title">{t(lang, "runCommand")}</div>
            <div className="modal-sub">{suggestion.title}</div>
          </div>
        </div>
        <div className="modal-body">
          {suggestion._policyReason && (
            <div className="policy-reason-banner">
              <Icon.shield />
              <div>
                <div className="policy-reason-h">
                  {suggestion._policyReason === "forbidden"
                    ? t(lang, "blockedByPattern")
                    : suggestion._policyReason === "high-risk"
                      ? t(lang, "riskHighFull")
                      : suggestion._policyReason === "not-trusted"
                        ? (lang === "ko" ? "신뢰된 경로 밖" : "Outside trusted dirs")
                        : t(lang, "requiresHigher")}
                </div>
                {suggestion._policyBlocker && (
                  <code className="policy-reason-pattern">{suggestion._policyBlocker}</code>
                )}
              </div>
            </div>
          )}
          <div className="approval-row">
            <div className="lbl">{t(lang, "cwd")}</div>
            <div className="val">{activeProject.path}</div>
          </div>
          <div className="approval-row">
            <div className="lbl">{t(lang, "branch")}</div>
            <div className="val">
              <span className="accent">{activeProject.branch}</span>
              <span className="meta"> · {activeProject.changedFiles} {t(lang, "changes")}</span>
            </div>
          </div>
          <div className="approval-row">
            <div className="lbl">{t(lang, "command")}</div>
            <div className="approval-cmd-list">
              {suggestion.commands.map((c, i) => {
                const targetLabel = c.target === "new"
                  ? (lang === "ko" ? "새 탭" : "new tab")
                  : tabs.find((tb) => tb.id === c.target)?.title || c.target;
                return (
                  <div className="approval-cmd" key={i}>
                    <span><span className="order">{i + 1}.</span>{c.cmd}</span>
                    <span className={"risk " + c.risk}>{t(lang, "risk" + c.risk[0].toUpperCase() + c.risk.slice(1))}</span>
                    <span style={{ color: "var(--text-dim)", fontSize: 10.5 }}>→ [{targetLabel}]</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="approval-row">
            <div className="lbl">{t(lang, "explainBeforeRun")}</div>
            <div className="val" style={{ fontFamily: "var(--font-ui)", color: "var(--text-muted)" }}>
              {suggestion.note}
            </div>
          </div>
          <div className="approval-row">
            <div className="lbl">{t(lang, "rollback")}</div>
            <div className="val" style={{ color: "var(--accent)", fontFamily: "var(--font-ui)" }}>
              {lang === "ko" ? "예 — 프로세스만 종료, 파일은 수정하지 않음" : "Yes — kills a process only, no file changes"}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{t(lang, "cancel")}</button>
          <button className="btn btn-secondary" onClick={onClose}>{t(lang, "deny")}</button>
          <button className="btn btn-primary" onClick={() => onApprove(suggestion)}>
            <Icon.spark /> {t(lang, "approve")}
          </button>
        </div>
      </div>
    </div>
  );
}

function OAuthModal({ lang, initialProvider, onClose, onConnect }) {
  const [stage, setStage] = React.useState("pick"); // pick | browser | success
  const [selected, setSelected] = React.useState(initialProvider || "codex");

  const goBrowser = () => {
    setStage("browser");
    setTimeout(() => setStage("success"), 2400);
  };

  const providerMeta = {
    claude: {
      label: "Claude",
      abbr: "Cl",
      sub: lang === "ko" ? "Anthropic 공식 OAuth" : "Anthropic official OAuth",
      url: "https://claude.ai/oauth/authorize?client_id=gtum&scope=read.files...",
    },
    codex: {
      label: "Codex",
      abbr: "Cx",
      sub: lang === "ko" ? "OpenAI 공식 로그인" : "OpenAI official sign-in",
      url: "https://auth.openai.com/oauth/authorize?client_id=gtum&scope=...",
    },
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-ico"><Icon.shield /></div>
          <div>
            <div className="modal-title">{t(lang, "connectProvider")}</div>
            <div className="modal-sub">{t(lang, "connectIntro")}</div>
          </div>
        </div>

        {stage === "pick" && (
          <div className="modal-body">
            <div className="oauth-provider-pick">
              {["claude", "codex"].map((id) => {
                const m = providerMeta[id];
                return (
                  <div
                    key={id}
                    className={"oauth-card" + (selected === id ? " selected" : "")}
                    onClick={() => setSelected(id)}
                  >
                    <div className={"mark " + id}>{m.abbr}</div>
                    <div className="ttl">{m.label}</div>
                    <div className="sub">{m.sub}</div>
                    {selected === id && <div className="check">✓</div>}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 10, lineHeight: 1.5 }}>
              {t(lang, "connectDetails")}
            </div>
          </div>
        )}

        {stage === "browser" && (
          <div className="modal-body">
            <div className="browser-sim">
              <div className="browser-bar">
                <div className="lights"><span className="l" /><span className="l" /><span className="l" /></div>
                <div className="url">{providerMeta[selected].url}</div>
              </div>
              <div className="browser-body">
                <div className="spin-big" />
                <div style={{ color: "var(--text)" }}>{providerMeta[selected].label} {lang === "ko" ? "공식 로그인 페이지" : "official sign-in"}</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t(lang, "waitingCallback")}</div>
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 8, fontFamily: "var(--font-mono)" }}>
              {lang === "ko" ? "콜백 URL:" : "Callback URL:"} gtum://oauth/callback
            </div>
          </div>
        )}

        {stage === "success" && (
          <div className="modal-body">
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div
                style={{
                  width: 36, height: 36, borderRadius: 9,
                  background: "color-mix(in oklab, var(--accent) 18%, var(--surface-2))",
                  color: "var(--accent)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16, fontWeight: 700,
                }}
              >✓</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {providerMeta[selected].label} · {t(lang, "connectSuccess")}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
                  {t(lang, "sessionExpiry")} 30{t(lang, "days")} · {lang === "ko" ? "OS 보안 저장소에 저장됨" : "Saved to OS keychain"}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {t(lang, "sessionScope")}
            </div>
            <div className="scope-list">
              {["files.read", "terminal.read", "exec.suggest", "exec.run (approval)"].map((s) => (
                <div className="sc" key={s}><span className="dot" />{s}</div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-foot">
          {stage === "pick" && (
            <>
              <button className="btn btn-ghost" onClick={onClose}>{t(lang, "cancel")}</button>
              <button className="btn btn-primary" onClick={goBrowser}>
                {t(lang, "openBrowser")}
              </button>
            </>
          )}
          {stage === "browser" && (
            <>
              <button className="btn btn-ghost" onClick={onClose}>{t(lang, "cancel")}</button>
              <button className="btn btn-secondary" disabled style={{ opacity: 0.5 }}>
                {t(lang, "waitingCallback")}
              </button>
            </>
          )}
          {stage === "success" && (
            <button className="btn btn-primary" onClick={() => { onConnect(selected); onClose(); }}>
              {lang === "ko" ? "완료" : "Done"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ApprovalModal, OAuthModal, SettingsModal, ApprovalToast });

// ApprovalToast — bottom-right notification for auto-approved actions.
// Includes a 'Undo' button. The host dismisses after a timeout but the
// user can act on it manually before that.
function ApprovalToast({ lang, toast, onDismiss, onUndo }) {
  return (
    <div className="approval-toast" role="status">
      <div className="toast-ico">
        <Icon.spark />
      </div>
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        <div className="toast-cmd">{toast.cmd}</div>
        <div className="toast-sub">{t(lang, "autoRanInline")}</div>
      </div>
      <button className="toast-btn" onClick={onUndo}>
        {t(lang, "undo")}
      </button>
      <button className="toast-x" onClick={onDismiss} title="dismiss">
        <Icon.x />
      </button>
    </div>
  );
}

// SettingsModal — full settings page with tabs in a left rail.
// Sections: Connections / Models / Appearance / Execution / About.
function SettingsModal({
  lang, providers, onClose, onConnect, onDisconnect, onSwitchModel,
  accent, accentOptions, onSetAccent,
  mode, onSetMode,
  parallelLimit, onSetParallelLimit,
  approvalPolicy, onSetApprovalPolicy,
  autoApprovalLog,
  streamResponses, onSetStreamResponses,
}) {
  const [section, setSection] = React.useState("connections");

  const sections = [
    { id: "connections", label: t(lang, "settingsConnections") },
    { id: "models",      label: t(lang, "settingsModels") },
    { id: "appearance",  label: t(lang, "settingsAppearance") },
    { id: "execution",   label: t(lang, "settingsExecution") },
    { id: "about",       label: t(lang, "settingsAbout") },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-rail">
          <div className="settings-rail-title">{t(lang, "settingsTitle")}</div>
          {sections.map((s) => (
            <button
              key={s.id}
              className={"settings-rail-item" + (section === s.id ? " active" : "")}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="settings-body">
          <button className="settings-close" onClick={onClose} title={t(lang, "cancel")}>
            <Icon.x />
          </button>

          {section === "connections" && (
            <div className="settings-pane">
              <h3 className="settings-h">{t(lang, "settingsConnections")}</h3>
              <p className="settings-sub">{t(lang, "connectDetails")}</p>
              <div className="settings-providers">
                {providers.map((p) => (
                  <div key={p.id} className={"settings-provider " + (p.state === "connected" ? "connected" : "")}>
                    <div className={"provider-mark " + p.id} style={{ width: 36, height: 36, fontSize: 13 }}>
                      {p.abbr}
                    </div>
                    <div className="settings-provider-info">
                      <div className="settings-provider-name">{p.label}</div>
                      <div className="settings-provider-sub">
                        {p.state === "connected"
                          ? <>
                              <span className="dot-ok" /> {t(lang, "connected")}
                              <span className="dot-sep">·</span>
                              {p.expiresInDays == null
                                ? (lang === "ko" ? "CLI 세션" : "CLI session")
                                : <>{t(lang, "sessionExpiry")} {p.expiresInDays}{t(lang, "days")}</>}
                              <span className="dot-sep">·</span>
                              {p.scope.length} {lang === "ko" ? "권한" : "scopes"}
                            </>
                          : p.state === "error"
                            ? <span style={{ color: "var(--warn)" }}>{p.lastError || (lang === "ko" ? "연결 확인 필요" : "Connection needs attention")}</span>
                            : p.state === "pending"
                              ? <span style={{ color: "var(--text-dim)" }}>{lang === "ko" ? "로그인 확인 중" : "Checking login"}</span>
                              : <span style={{ color: "var(--text-dim)" }}>{lang === "ko" ? "연결되지 않음" : "Not connected"}</span>}
                      </div>
                    </div>
                    {p.state === "connected" ? (
                      <button className="btn btn-ghost" onClick={() => onDisconnect(p.id)}>{t(lang, "disconnect")}</button>
                    ) : (
                      <button className="btn btn-primary" onClick={() => onConnect(p.id)}>{t(lang, "connect")}</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === "models" && (
            <div className="settings-pane">
              <h3 className="settings-h">{t(lang, "settingsModels")}</h3>
              <p className="settings-sub">
                {lang === "ko" ? "각 제공자별로 사용할 기본 모델을 선택하세요." : "Pick the default model per provider."}
              </p>
              {providers.filter((p) => p.state === "connected").length === 0 && (
                <div className="settings-empty">{t(lang, "noConnectedProviders")}</div>
              )}
              {providers.map((p) => (
                <div key={p.id} className="model-section">
                  <div className="model-section-h">
                    <div className={"provider-mark " + p.id} style={{ width: 26, height: 26, fontSize: 11 }}>
                      {p.abbr}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="model-section-name">{p.label}</div>
                      <div className="model-section-sub">
                        {p.state === "connected"
                          ? <>{t(lang, "activeProvider")}: <span style={{ color: "var(--accent)" }}>{p.activeModel}</span></>
                          : (lang === "ko" ? "연결 후 모델을 선택할 수 있습니다" : "Connect to pick a model")}
                      </div>
                    </div>
                  </div>
                  <div className="model-grid">
                    {p.models.map((m) => (
                      <button
                        key={m.id}
                        className={"model-card" + (p.activeModel === m.id ? " active" : "") + (p.state !== "connected" ? " disabled" : "")}
                        disabled={p.state !== "connected"}
                        onClick={() => onSwitchModel(p.id, m.id)}
                      >
                        <div className="model-card-h">
                          <div className="model-card-name">{m.label}</div>
                          <div className={"model-card-tier " + m.tier}>{t(lang, m.tier)}</div>
                        </div>
                        <div className="model-card-meta">
                          <span>{t(lang, "contextWindow")}: <b>{m.ctx}</b></span>
                          <span>· {t(lang, "responseSpeed")}: <b>{m.speed}</b></span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {section === "appearance" && (
            <div className="settings-pane">
              <h3 className="settings-h">{t(lang, "settingsAppearance")}</h3>
              <div className="settings-row">
                <div className="settings-row-label">{lang === "ko" ? "액센트 컬러" : "Accent color"}</div>
                <div className="accent-swatches">
                  {accentOptions.map((c) => (
                    <button
                      key={c}
                      className={"accent-swatch" + (accent === c ? " active" : "")}
                      style={{ background: c }}
                      onClick={() => onSetAccent(c)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === "execution" && (
            <div className="settings-pane">
              <h3 className="settings-h">{t(lang, "settingsExecution")}</h3>
              <p className="settings-sub">
                {lang === "ko" ? "에이전트가 명령을 실제로 실행하기 전 확인하는 방식을 제어합니다." : "Controls how the agent confirms before running commands."}
              </p>

              <ExecutionPolicy
                lang={lang}
                policy={approvalPolicy}
                onChange={onSetApprovalPolicy}
              />

              <AutoApprovalLog lang={lang} log={autoApprovalLog} />

              <div className="settings-divider" />

              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t(lang, "mode")}</div>
                  <div className="settings-row-hint">
                    {lang === "ko" ? "컨텍스트 크기·모델·교차 리뷰를 조정하는 실행 정책" : "Policy bundling context size, model, cross-review"}
                  </div>
                </div>
                <div className="mode-pill" style={{ width: "auto" }}>
                  {["fast", "balanced", "deep"].map((m) => (
                    <button
                      key={m}
                      className={mode === m ? "active" : ""}
                      onClick={() => onSetMode(m)}
                    >{t(lang, m)}</button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t(lang, "parallelLimit")}</div>
                  <div className="settings-row-hint">{t(lang, "parallelLimitHint")}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="range" min="1" max="8" value={parallelLimit}
                    onChange={(e) => onSetParallelLimit(Number(e.target.value))}
                    style={{ width: 160, accentColor: "var(--accent)" }}
                  />
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", minWidth: 16, textAlign: "right" }}>{parallelLimit}</span>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t(lang, "streamResponses")}</div>
                  <div className="settings-row-hint">{t(lang, "streamResponsesHint")}</div>
                </div>
                <SettingsToggle value={streamResponses} onChange={onSetStreamResponses} />
              </div>
            </div>
          )}

          {section === "about" && (
            <div className="settings-pane">
              <h3 className="settings-h">{t(lang, "settingsAbout")}</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
                <div><b style={{ color: "var(--text)" }}>gtum</b> · prototype build</div>
                <div>{lang === "ko" ? "로컬 데스크톱 워크스페이스 — 프로젝트 + 멀티 터미널 + 멀티 에이전트" : "Local desktop workspace — projects + multi-terminal + multi-agent"}</div>
                <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>Tauri · Rust · React · xterm.js</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsToggle({ value, onChange }) {
  return (
    <button
      type="button"
      className="twk-toggle"
      data-on={value ? "1" : "0"}
      role="switch"
      aria-checked={!!value}
      onClick={() => onChange(!value)}
    ><i /></button>
  );
}

// ── Execution policy editor ─────────────────────────────────────────────
// Preset bar + per-risk dropdowns + trusted dirs + forbidden patterns.
// Choosing a preset overwrites lowRisk/midRisk to the preset values; editing
// either dropdown flips the preset to 'custom'.
function ExecutionPolicy({ lang, policy, onChange }) {
  const applyPreset = (presetId) => {
    const preset = APPROVAL_PRESETS[presetId];
    onChange({ ...policy, preset: presetId, ...preset });
  };
  const setLevel = (key, value) => {
    onChange({ ...policy, preset: "custom", [key]: value });
  };
  const addPattern = (text) => {
    const v = text.trim();
    if (!v) return;
    if (policy.forbiddenPatterns.includes(v)) return;
    onChange({ ...policy, forbiddenPatterns: [...policy.forbiddenPatterns, v] });
  };
  const removePattern = (pat) => {
    onChange({ ...policy, forbiddenPatterns: policy.forbiddenPatterns.filter((p) => p !== pat) });
  };
  const addDir = (text) => {
    const v = text.trim();
    if (!v) return;
    if (policy.trustedDirs.includes(v)) return;
    onChange({ ...policy, trustedDirs: [...policy.trustedDirs, v] });
  };
  const removeDir = (d) => {
    onChange({ ...policy, trustedDirs: policy.trustedDirs.filter((x) => x !== d) });
  };

  return (
    <div className="policy-box">
      <div className="policy-h">
        <div>
          <div className="settings-row-label">{t(lang, "approvalPolicy")}</div>
          <div className="settings-row-hint">
            {lang === "ko"
              ? "프리셋을 고르거나 위험 등급별로 세부 설정하세요."
              : "Pick a preset, or fine-tune per risk level."}
          </div>
        </div>
        <div className="policy-preset-bar">
          {["cautious", "default", "bold", "custom"].map((p) => (
            <button
              key={p}
              className={policy.preset === p ? "active" : ""}
              onClick={() => p !== "custom" && applyPreset(p)}
              disabled={p === "custom"}
              title={p === "custom" ? (lang === "ko" ? "직접 수정하면 자동 전환됩니다" : "Auto-set when you customize") : ""}
            >
              {t(lang, "preset" + p[0].toUpperCase() + p.slice(1))}
            </button>
          ))}
        </div>
      </div>

      <div className="policy-grid">
        <PolicyRow
          lang={lang}
          level="low"
          value={policy.lowRisk}
          options={["always-ask", "auto", "auto-trusted"]}
          onChange={(v) => setLevel("lowRisk", v)}
        />
        <PolicyRow
          lang={lang}
          level="mid"
          value={policy.midRisk}
          options={["always-ask", "auto", "auto-trusted"]}
          onChange={(v) => setLevel("midRisk", v)}
        />
        <PolicyRow
          lang={lang}
          level="high"
          value="always-ask"
          options={["always-ask"]}
          locked
        />
      </div>

      <div className="policy-lists">
        <ChipList
          label={t(lang, "trustedDirs")}
          hint={t(lang, "trustedDirsHint")}
          items={policy.trustedDirs}
          onAdd={addDir}
          onRemove={removeDir}
          placeholder={t(lang, "addDir")}
          chipClass="trust"
        />
        <ChipList
          label={t(lang, "forbiddenPatterns")}
          hint={t(lang, "forbiddenPatternsHint")}
          items={policy.forbiddenPatterns}
          onAdd={addPattern}
          onRemove={removePattern}
          placeholder={t(lang, "addPattern")}
          chipClass="forbid"
        />
      </div>
    </div>
  );
}

function PolicyRow({ lang, level, value, options, onChange, locked }) {
  const labels = {
    "always-ask": t(lang, "actionAlwaysAsk"),
    "auto":       t(lang, "actionAuto"),
    "auto-trusted": t(lang, "actionAutoTrusted"),
  };
  return (
    <div className={"policy-row risk-" + level + (locked ? " locked" : "")}>
      <div className="policy-row-info">
        <div className="policy-row-title">
          <span className={"risk-dot " + level} />
          {t(lang, "risk" + level[0].toUpperCase() + level.slice(1) + "Full")}
          {locked && <span className="lock-tag">🔒</span>}
        </div>
        <div className="policy-row-hint">{t(lang, "risk" + level[0].toUpperCase() + level.slice(1) + "Desc")}</div>
      </div>
      <div className="policy-seg">
        {options.map((opt) => (
          <button
            key={opt}
            className={value === opt ? "active" : ""}
            disabled={locked}
            onClick={() => !locked && onChange(opt)}
          >{labels[opt]}</button>
        ))}
      </div>
    </div>
  );
}

function ChipList({ label, hint, items, onAdd, onRemove, placeholder, chipClass }) {
  const [text, setText] = React.useState("");
  const submit = () => { onAdd(text); setText(""); };
  return (
    <div className="chip-list">
      <div className="chip-list-h">
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-hint">{hint}</div>
      </div>
      <div className="chip-list-items">
        {items.map((it) => (
          <span key={it} className={"chip-pill " + chipClass}>
            <span>{it}</span>
            <button className="chip-x" onClick={() => onRemove(it)} title="remove">
              <Icon.x />
            </button>
          </span>
        ))}
      </div>
      <div className="chip-list-add">
        <input
          className="chip-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={placeholder}
        />
        <button className="btn btn-secondary" onClick={submit} disabled={!text.trim()}>+</button>
      </div>
    </div>
  );
}

// ── Recent auto-approvals ────────────────────────────────────────────────
function AutoApprovalLog({ lang, log }) {
  return (
    <div className="audit-box">
      <div className="audit-h">
        <div className="settings-row-label">{t(lang, "autoApproveLog")}</div>
        <div className="settings-row-hint">{lang === "ko" ? "최근 20개" : "Last 20"}</div>
      </div>
      {log.length === 0 ? (
        <div className="audit-empty">{t(lang, "noAutoApprovals")}</div>
      ) : (
        <div className="audit-rows">
          {log.map((entry) => (
            <div key={entry.id} className={"audit-row" + (entry.undone ? " undone" : "")}>
              <span className="audit-time">{entry.at}</span>
              <span className="audit-cmds">
                {entry.commands.map((c) => c.cmd).join("  ·  ")}
              </span>
              {entry.undone && (
                <span className="audit-tag">{lang === "ko" ? "되돌림" : "reverted"}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ----- src/app.jsx -----
// app.jsx — main app shell + state, using VS Code-style workspace store.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#5DF18A",
  "lang": "ko",
  "modeDefault": "balanced"
}/*EDITMODE-END*/;

const ACCENT_OPTIONS = ["#5DF18A", "#9D6BFF", "#FF7849", "#5BAEFF", "#F25DAB"];

const EXEC_OUTPUTS = {
  "lsof -ti:3001 | xargs -r kill -9": [
    { kind: "log", text: "94821" },
    { kind: "log", text: "✓ process killed", color: "ok" },
  ],
  "pnpm dev:api": [
    { kind: "log", text: "> aurora-api@0.4.2 dev:api" },
    { kind: "log", text: "> tsx watch src/server.ts" },
    { kind: "log", text: "[api] initializing kysely pool…", color: "dim" },
    { kind: "log", text: "[api] loaded 12 routes" },
    { kind: "log", text: "[api] listening on http://localhost:3001 ✓", color: "ok" },
    { kind: "log", text: "[api] ready in 642ms", color: "ok" },
  ],
};

function App() {
  const [t_, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const lang = t_.lang;
  const accent = t_.accent;
  const stageRef = React.useRef(null);
  const scalerRef = React.useRef(null);
  const windowRef = React.useRef(null);

  // OS window-chrome variant (mac traffic lights vs Windows caption buttons).
  // Start from a synchronous best guess, then refine via the Tauri runtime.
  const [os, setOs] = React.useState(initialOs);
  React.useEffect(() => {
    let alive = true;
    detectRuntimeOs().then((detected) => { if (alive) setOs(detected); });
    return () => { alive = false; };
  }, []);

  const [windowControls, setWindowControls] = React.useState(initialRuntimeWindowControls);
  React.useEffect(() => {
    if (windowControls.available) return undefined;
    let alive = true;
    createRuntimeWindowControls().then((controls) => { if (alive) setWindowControls(controls); });
    return () => { alive = false; };
  }, [windowControls.available]);

  const [maximized, setMaximized] = React.useState(false);

  const onToggleMax = React.useCallback(async () => {
    if (!windowControls.available) {
      setMaximized((m) => !m);
      return;
    }

    try {
      await windowControls.toggleMaximize();
      setMaximized((m) => !m);
    } catch {
      setMaximized((m) => !m);
    }
  }, [windowControls]);
  const onMinimize = React.useCallback(() => {
    windowControls.minimize().catch(() => undefined);
  }, [windowControls]);
  const onClose = React.useCallback(() => {
    windowControls.close().catch(() => undefined);
  }, [windowControls]);
  const onStartDrag = React.useCallback(() => {
    if (!windowControls.available) return;
    windowControls.startDragging().catch(() => undefined);
  }, [windowControls]);

  // Responsive: measure the window's real (design-space) width and derive a
  // width class that drives breadcrumb/pill compaction in CSS.
  const [winW, setWinW] = React.useState(1320);
  React.useEffect(() => {
    const el = windowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWinW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const widthClass = winW < 940 ? "w-sm" : winW < 1180 ? "w-md" : "w-lg";

  const [workspace, setWorkspace] = React.useState(WORKSPACE_INITIAL);
  const workspaceRef = React.useRef(WORKSPACE_INITIAL);
  const [activeProject, setActiveProject] = React.useState(PROJECT);
  const [projectBusy, setProjectBusy] = React.useState(false);
  const [projectError, setProjectError] = React.useState(null);
  const [providers, setProviders] = React.useState(PROVIDERS_INIT);
  const [tasks, setTasks] = React.useState(TASKS_INIT(lang));
  const [history, setHistory] = React.useState(COMMAND_HISTORY_INIT);
  const [messages, setMessages] = React.useState(CHAT_INIT(lang));
  const [isTyping, setIsTyping] = React.useState(false);
  const [mode, setMode] = React.useState(t_.modeDefault);
  const [approval, setApproval] = React.useState(null);
  const [oauth, setOauth] = React.useState(null);
  const [executing, setExecuting] = React.useState(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [agentOpen, setAgentOpen] = React.useState(true);
  const [sidebarWidth, setSidebarWidth] = React.useState(264);
  const [agentWidth, setAgentWidth] = React.useState(380);
  const SIDEBAR_DEFAULT = 264;
  const AGENT_DEFAULT = 380;
  const SIDEBAR_BOUNDS = { min: 180, max: 440, collapse: Math.round(SIDEBAR_DEFAULT * 0.2) };
  const AGENT_BOUNDS   = { min: 240, max: 560, collapse: Math.round(AGENT_DEFAULT * 0.2) };

  // Edge-triggered responsive reflow: collapse the agent panel below ~1180px
  // and the sidebar below ~940px, re-opening when crossing back. Only fires on
  // threshold crossings so manual toggles between breakpoints stick.
  const prevWRef = React.useRef(winW);
  React.useEffect(() => {
    const w = winW;
    const p = prevWRef.current;
    prevWRef.current = w;
    if (p >= 1180 && w < 1180) setAgentOpen(false);
    else if (p < 1180 && w >= 1180) setAgentOpen(true);
    if (p >= 940 && w < 940) setSidebarOpen(false);
    else if (p < 940 && w >= 940) setSidebarOpen(true);
  }, [winW]);

  // Resize a side panel by dragging the divider. Tracks pointer delta and
  // either snaps to bounds or collapses the panel if dragged past the
  // collapse threshold.
  const startResize = (side) => (e) => {
    e.preventDefault();
    const bounds = side === "left" ? SIDEBAR_BOUNDS : AGENT_BOUNDS;
    const startX = e.clientX;
    const startW = side === "left" ? sidebarWidth : agentWidth;
    const setW   = side === "left" ? setSidebarWidth : setAgentWidth;
    const setOpen = side === "left" ? setSidebarOpen : setAgentOpen;
    // Keep the drag math resilient if a future shell reintroduces transform
    // scaling; today's shell fills the viewport with --scale resolving to 1.
    const scale = parseFloat(getComputedStyle(scalerRef.current).getPropertyValue("--scale")) || 1;
    document.body.classList.add(side === "left" ? "resizing-h-left" : "resizing-h-right");

    const onMove = (ev) => {
      const dx = (ev.clientX - startX) / scale;
      const raw = side === "left" ? startW + dx : startW - dx;
      const next = Math.max(bounds.collapse - 20, Math.min(bounds.max, raw));
      setW(next);
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("resizing-h-left", "resizing-h-right");
      const dx = (ev.clientX - startX) / scale;
      const final = side === "left" ? startW + dx : startW - dx;
      if (final < bounds.collapse) {
        setOpen(false);
        setW(side === "left" ? SIDEBAR_DEFAULT : AGENT_DEFAULT); // restore default on re-expand
      } else {
        setW(Math.max(bounds.min, Math.min(bounds.max, final)));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [activeProviderId, setActiveProviderId] = React.useState(
    agentAuthRuntimeService.hasRuntime() || agentSuggestionRuntimeService.hasRuntime()
      ? "codex"
      : "claude"
  );
  const [parallelLimit, setParallelLimit] = React.useState(3);
  const [approvalPolicy, setApprovalPolicy] = React.useState(APPROVAL_POLICY_INIT);
  const [autoApprovalLog, setAutoApprovalLog] = React.useState([]);
  const [toast, setToast] = React.useState(null);
  const [streamResponses, setStreamResponses] = React.useState(true);
  const activeModelId = providers.find((p) => p.id === activeProviderId)?.activeModel
    || providers.find((p) => p.state === "connected")?.activeModel;

  React.useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  const closeRuntimeTabs = React.useCallback((tabs) => {
    for (const tab of tabs) {
      if (tab?.terminalSessionId == null) continue;
      terminalRuntimeService.closeSession(tab.terminalSessionId).catch(() => undefined);
    }
  }, []);

  const onSwitchModel = (providerId, modelId) => {
    setActiveProviderId(providerId);
    setProviders((prev) => prev.map((p) =>
      p.id === providerId ? { ...p, activeModel: modelId } : p));
  };
  const applyProviderConnection = React.useCallback((connection) => {
    setProviders((prev) => mergeRuntimeProviderConnections(prev, [connection]));
    if (connection.status === "connected") setActiveProviderId(connection.provider);
  }, []);
  const markProviderError = React.useCallback((providerId, message) => {
    setProviders((prev) => prev.map((p) => p.id === providerId
      ? { ...p, state: "error", lastError: message, expiresInDays: null }
      : p));
  }, []);
  const onDisconnect = async (providerId) => {
    if (agentAuthRuntimeService.hasRuntime()) {
      try {
        const connection = await agentAuthRuntimeService.disconnect(providerId);
        applyProviderConnection(connection);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        markProviderError(providerId, message);
        return;
      }
    }

    setProviders((prev) => prev.map((p) =>
      p.id === providerId ? { ...p, state: "disconnected", scope: [], expiresInDays: null } : p));
  };

  React.useEffect(() => {
    setMessages(CHAT_INIT(lang));
    setTasks(TASKS_INIT(lang));
  }, [lang]);
  React.useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
  }, [accent]);
  React.useEffect(() => {
    window.__GTUM_BACKEND_BRIDGE__ = projectRuntimeService.getBridgeState(activeProject);
  }, [activeProject]);
  React.useEffect(() => {
    if (!agentAuthRuntimeService.hasRuntime()) return undefined;

    let cancelled = false;
    agentAuthRuntimeService.listConnections()
      .then((connections) => {
        if (cancelled) return;
        setProviders((prev) => mergeRuntimeProviderConnections(prev, connections));
        const codex = connections.find((connection) => connection.provider === "codex");
        if (codex?.status === "connected") setActiveProviderId("codex");
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        markProviderError("codex", message);
      });

    return () => {
      cancelled = true;
    };
  }, [markProviderError]);
  React.useEffect(() => {
    if (!terminalRuntimeService.hasRuntime()) return undefined;

    let cancelled = false;
    const pollRuntimeTerminals = async () => {
      const runtimeTabs = allTabs(workspaceRef.current)
        .map(({ tab }) => tab)
        .filter((tab) => tab?.runtimeBacked && tab.terminalSessionId != null);

      for (const tab of runtimeTabs) {
        try {
          const logs = await terminalRuntimeService.readLogs(tab.terminalSessionId, 400);
          if (cancelled) return;
          setWorkspace((current) => updateTab(current, tab.id, (currentTab) => {
            if (
              currentTab.lastLogLineCount === logs.logLineCount &&
              currentTab.runtimeUpdatedAt === logs.updatedAt &&
              currentTab.status === logs.status
            ) {
              return currentTab;
            }

            return {
              ...currentTab,
              status: logs.status,
              runtimeStatus: logs.runtimeStatus,
              lastLogLineCount: logs.logLineCount,
              runtimeUpdatedAt: logs.updatedAt,
              lines: logs.lines.length > 0 ? logs.lines : currentTab.lines,
            };
          }));
        } catch (error) {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          setWorkspace((current) => updateTab(current, tab.id, (currentTab) => ({
            ...currentTab,
            status: "failed",
            lines: [
              ...currentTab.lines,
              { kind: "log", text: `terminal read failed: ${message}`, color: "err" },
            ],
          })));
        }
      }
    };

    void pollRuntimeTerminals();
    const interval = window.setInterval(() => {
      void pollRuntimeTerminals();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const pushProjectMessage = (message) => {
    setMessages((prev) => [...prev, {
      id: "project-" + Date.now(),
      role: "assistant",
      roleLabel: lang === "ko" ? "시스템" : "System",
      at: nowHm(),
      content: message,
    }]);
  };

  const handleOpenProject = async () => {
    setProjectBusy(true);
    setProjectError(null);
    try {
      const selectedPath = await selectRuntimeProjectFolder(activeProject.path);
      if (!selectedPath) return;
      const nextProject = await readRuntimeProjectOverview(selectedPath);
      setActiveProject(nextProject);
      setHistory((prev) => [...prev, {
        at: nowHm(),
        tab: "workspace",
        cmd: `open ${nextProject.path}`,
        ok: true,
      }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProjectError(message);
      pushProjectMessage(lang === "ko"
        ? `프로젝트를 열지 못했어: ${message}`
        : `Could not open the project: ${message}`);
    } finally {
      setProjectBusy(false);
    }
  };

  const handleOpenFile = async (path, name) => {
    setProjectError(null);
    try {
      const tab = await readRuntimeProjectFile(activeProject, path, name);
      setWorkspace((w) => openFile(w, w.activeGroupId, tab));
      setHistory((prev) => [...prev, {
        at: nowHm(),
        tab: "editor",
        cmd: `open ${tab.displayPath || tab.path}`,
        ok: true,
      }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProjectError(message);
      pushProjectMessage(lang === "ko"
        ? `파일을 열지 못했어: ${message}`
        : `Could not open the file: ${message}`);
    }
  };

  const requestRuntimeAgentSuggestions = React.useCallback(async (text, messageId, active) => {
    try {
      const suggestions = await agentSuggestionRuntimeService.requestSuggestions({
        provider: activeProviderId,
        project: activeProject,
        activeTab: active,
        userTask: text,
        executionMode: mode,
      });

      const runtimeMessages = suggestions.map((suggestion, index) => ({
        id: messageId + "-runtime-" + index,
        role: "assistant",
        at: nowHm(),
        suggestion,
      }));

      if (runtimeMessages.length === 0) {
        setMessages((prev) => [...prev, {
          id: messageId + "-empty",
          role: "assistant",
          roleLabel: "Codex",
          at: nowHm(),
          content: lang === "ko"
            ? "Codex가 실행 가능한 제안을 반환하지 않았어."
            : "Codex did not return an executable suggestion.",
        }]);
        return;
      }

      setMessages((prev) => [...prev, ...runtimeMessages]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [...prev, {
        id: messageId + "-error",
        role: "assistant",
        roleLabel: "Codex",
        at: nowHm(),
        content: lang === "ko"
          ? `Codex 제안을 가져오지 못했어: ${message}`
          : `Could not request Codex suggestions: ${message}`,
      }]);
    } finally {
      setIsTyping(false);
    }
  }, [activeProject, activeProviderId, lang, mode]);

  // ── workspace actions (thin wrappers around the pure store) ──────────
  const actions = React.useMemo(() => ({
    setActiveTab: (gId, tId) => setWorkspace((w) => setActiveTab(w, gId, tId)),
    setActiveGroup: (gId) => setWorkspace((w) => setActiveGroup(w, gId)),
    reorderTab: (gId, tId, toIdx) => setWorkspace((w) => {
      const g = w.groups[gId]; if (!g) return w;
      const from = g.tabs.findIndex((tb) => tb.id === tId);
      return reorderTab(w, gId, from, toIdx);
    }),
    moveTab: (tId, fromG, toG, idx) => setWorkspace((w) => moveTab(w, tId, fromG, toG, idx)),
    moveTabToNewGroup: (gId, tId, pos) => setWorkspace((w) => moveTabToNewGroup(w, gId, tId, pos)),
    splitGroup: (gId, pos) => setWorkspace((w) => splitGroup(w, gId, pos)),
    dropTabOnEdge: (tId, fromG, toG, pos) => setWorkspace((w) => dropTabOnEdge(w, tId, fromG, toG, pos)),
    closeTab: (gId, tId) => {
      const found = findTab(workspaceRef.current, tId);
      if (found?.tab) closeRuntimeTabs([found.tab]);
      setWorkspace((w) => closeTab(w, gId, tId));
    },
    closeOtherTabs: (gId, tId) => {
      const group = workspaceRef.current.groups[gId];
      if (group) closeRuntimeTabs(group.tabs.filter((tab) => tab.id !== tId));
      setWorkspace((w) => closeOtherTabs(w, gId, tId));
    },
    closeTabsToRight: (gId, tId) => {
      const group = workspaceRef.current.groups[gId];
      if (group) {
        const idx = group.tabs.findIndex((tab) => tab.id === tId);
        closeRuntimeTabs(idx >= 0 ? group.tabs.slice(idx + 1) : []);
      }
      setWorkspace((w) => closeTabsToRight(w, gId, tId));
    },
    closeTabsToLeft: (gId, tId) => {
      const group = workspaceRef.current.groups[gId];
      if (group) {
        const idx = group.tabs.findIndex((tab) => tab.id === tId);
        closeRuntimeTabs(idx >= 0 ? group.tabs.slice(0, idx) : []);
      }
      setWorkspace((w) => closeTabsToLeft(w, gId, tId));
    },
    closeAllTabs: (gId) => {
      const group = workspaceRef.current.groups[gId];
      if (group) closeRuntimeTabs(group.tabs);
      setWorkspace((w) => closeAllTabs(w, gId));
    },
    newTab: (gId) => {
      const localId = uid("t");
      const title = lang === "ko" ? "새 탭" : "new";
      setWorkspace((w) => openTab(w, gId, {
        id: localId,
        title,
        cwd: ".",
        status: "running",
        runtimeBacked: false,
        terminalSessionId: null,
        lines: [{ kind: "log", text: `${activeProject.path} (${activeProject.branch}) $`, color: "dim" }],
      }));

      terminalRuntimeService.createTerminalTab({
        projectPath: activeProject.path,
        title,
        cwd: ".",
      }).then((runtimeTab) => {
        setWorkspace((w) => updateTab(w, localId, (tab) => ({
          ...tab,
          ...runtimeTab,
          id: localId,
          title,
          lines: runtimeTab.lines.length > 0 ? runtimeTab.lines : tab.lines,
        })));
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setWorkspace((w) => updateTab(w, localId, (tab) => ({
          ...tab,
          status: "failed",
          lines: [...tab.lines, { kind: "log", text: message, color: "err" }],
        })));
      });
    },
  }), [closeRuntimeTabs, lang, activeProject.path, activeProject.branch]);

  // ── Send / approve flow uses workspace lookups ────────────────────────
  const activeTab = activeTabOf(workspace);

  const onSend = (text) => {
    const id = "u" + Date.now();
    const attachedTab = activeTab;
    setMessages((prev) => [...prev, {
      id, role: "user", at: nowHm(), content: text,
      contextAttached: [attachedTab?.id || ""],
    }]);
    setIsTyping(true);

    if (agentSuggestionRuntimeService.hasRuntime() && activeProviderId === "codex") {
      void requestRuntimeAgentSuggestions(text, id, attachedTab);
      return;
    }

    setTimeout(() => {
      const reply = canned(text, lang, attachedTab);
      setMessages((prev) => [...prev, ...reply.map((r, i) => ({
        ...r, id: id + "-r" + i, at: nowHm(),
      }))]);
      setIsTyping(false);
    }, mode === "fast" ? 700 : mode === "balanced" ? 1100 : 1700);
  };

  // Append output to a specific tab (anywhere in any group)
  const appendToTab = (tabId, lines) => {
    setWorkspace((w) => {
      const found = findTab(w, tabId);
      if (!found) return w;
      const { group } = found;
      return {
        ...w,
        groups: {
          ...w.groups,
          [group.id]: {
            ...group,
            tabs: group.tabs.map((tb) => tb.id === tabId ? { ...tb, lines: [...tb.lines, ...lines] } : tb),
          },
        },
      };
    });
  };
  const setTabStatus = (tabId, status, cmd) => {
    setWorkspace((w) => {
      const found = findTab(w, tabId);
      if (!found) return w;
      const { group } = found;
      return {
        ...w,
        groups: {
          ...w.groups,
          [group.id]: {
            ...group,
            tabs: group.tabs.map((tb) => tb.id === tabId ? { ...tb, status, cmd: cmd ?? tb.cmd } : tb),
          },
        },
      };
    });
  };

  const onApprove = async (sugg, { auto = false, blockedReason = null } = {}) => {
    setApproval(null);
    const startedAt = nowHm();
    const ranCommands = [];
    for (let i = 0; i < sugg.commands.length; i++) {
      const c = sugg.commands[i];
      let targetTabId = c.target;
      let handledByRuntime = false;
      if (targetTabId === "new") {
        // Add a new tab into the active group, marked as running
        const newId = "t-fix-" + Date.now() + "-" + i;
        const title = lang === "ko" ? `수정-${i + 1}` : `fix-${i + 1}`;
        setWorkspace((w) => openTab(w, w.activeGroupId, {
          id: newId,
          title,
          shell: "zsh", cwd: ".", status: "running", cmd: c.cmd,
          runtimeBacked: false,
          terminalSessionId: null,
          lines: [{ kind: "cmd", text: c.cmd }],
        }));
        targetTabId = newId;

        if (terminalRuntimeService.hasRuntime()) {
          setExecuting(c.cmd);
          try {
            const runtimeTab = await terminalRuntimeService.createTerminalTabWithCommand({
              projectPath: activeProject.path,
              title,
              cwd: ".",
              command: c.cmd,
            });
            setWorkspace((w) => updateTab(w, newId, (tab) => ({
              ...tab,
              ...runtimeTab,
              id: newId,
              title,
              cmd: c.cmd,
              status: "running",
              lines: runtimeTab.lines.length > 0 ? runtimeTab.lines : tab.lines,
            })));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setWorkspace((w) => updateTab(w, newId, (tab) => ({
              ...tab,
              status: "failed",
              lines: [...tab.lines, { kind: "log", text: message, color: "err" }],
            })));
          } finally {
            setExecuting(null);
          }
          handledByRuntime = true;
        }
      } else {
        setWorkspace((w) => {
          const f = findTab(w, targetTabId);
          if (!f) return w;
          return setActiveTab(w, f.group.id, targetTabId);
        });

        const found = findTab(workspaceRef.current, targetTabId);
        if (found?.tab?.runtimeBacked && found.tab.terminalSessionId != null) {
          appendToTab(targetTabId, [{ kind: "log", text: "" }, { kind: "cmd", text: c.cmd }]);
          setTabStatus(targetTabId, "running", c.cmd);
          setExecuting(c.cmd);
          try {
            await terminalRuntimeService.executeCommand(found.tab.terminalSessionId, c.cmd);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendToTab(targetTabId, [{ kind: "log", text: message, color: "err" }]);
            setTabStatus(targetTabId, "failed", c.cmd);
          } finally {
            setExecuting(null);
          }
          handledByRuntime = true;
        } else {
          appendToTab(targetTabId, [{ kind: "log", text: "" }, { kind: "cmd", text: c.cmd }]);
          setTabStatus(targetTabId, "running", c.cmd);
        }
      }

      if (!handledByRuntime) {
        setExecuting(c.cmd);
        await sleep(900);
        const out = EXEC_OUTPUTS[c.cmd] || [{ kind: "log", text: "✓ done", color: "ok" }];
        appendToTab(targetTabId, out);
        setExecuting(null);
        const finalStatus = c.cmd.startsWith("pnpm dev") ? "running" : "idle";
        setTabStatus(targetTabId, finalStatus);
      }

      ranCommands.push({ tabId: targetTabId, cmd: c.cmd, risk: c.risk });

      setHistory((prev) => [...prev, {
        at: nowHm(),
        tab: findTab(workspace, targetTabId)?.tab.title || "new",
        cmd: c.cmd, ok: true,
      }]);
    }

    setMessages((prev) => [...prev, {
      id: "done-" + Date.now(),
      role: "assistant",
      at: nowHm(),
      autoRan: auto,
      completed: {
        summary: lang === "ko"
          ? `${sugg.commands.length}개 명령 실행 완료. backend가 다시 :3001에 떴어.`
          : `Ran ${sugg.commands.length} commands. backend is back up on :3001.`,
        commands: sugg.commands.map((c) => c.cmd),
      },
    }]);

    if (auto) {
      // Log it + show toast with undo
      const entry = {
        id: "auto-" + Date.now(),
        at: startedAt,
        suggestion: sugg,
        commands: ranCommands,
      };
      setAutoApprovalLog((prev) => [entry, ...prev].slice(0, 20));
      setToast({
        id: entry.id,
        title: lang === "ko" ? "자동 실행됨" : "Auto-ran",
        cmd: sugg.commands[0].cmd + (sugg.commands.length > 1 ? ` +${sugg.commands.length - 1}` : ""),
        suggestion: sugg,
      });
      setTimeout(() => setToast((t) => t?.id === entry.id ? null : t), 5500);
    }
  };

  // Policy-aware entry point — Decide whether to open modal or auto-run.
  const requestApproval = (sugg) => {
    const cwd = activeTab?.cwd || ".";
    const decision = policyDecideForSuggestion(approvalPolicy, sugg, cwd);
    if (decision.action === "auto") {
      onApprove(sugg, { auto: true });
      return;
    }
    // Open modal with policy reason attached so user knows why it didn't auto-run
    setApproval({ ...sugg, _policyReason: decision.blocker?.decision?.reason || null,
                  _policyBlocker: decision.blocker?.decision?.pattern || null });
  };

  const openRuntimeCodexLogin = async () => {
    const localId = "t-codex-login-" + Date.now();
    const title = "Codex Login";
    setWorkspace((w) => openTab(w, w.activeGroupId, {
      id: localId,
      title,
      shell: "zsh",
      cwd: ".",
      status: "running",
      cmd: CODEX_LOGIN_COMMAND,
      runtimeBacked: false,
      terminalSessionId: null,
      lines: [{ kind: "cmd", text: CODEX_LOGIN_COMMAND }],
    }));

    try {
      const runtimeTab = await agentAuthRuntimeService.openCodexLoginTerminal({
        projectPath: activeProject.path,
        title,
        cwd: ".",
      });
      if (!runtimeTab) return;

      setWorkspace((w) => updateTab(w, localId, (tab) => ({
        ...tab,
        ...runtimeTab,
        id: localId,
        title,
        cmd: CODEX_LOGIN_COMMAND,
        status: "running",
        lines: runtimeTab.lines.length > 0 ? runtimeTab.lines : tab.lines,
      })));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkspace((w) => updateTab(w, localId, (tab) => ({
        ...tab,
        status: "failed",
        lines: [...tab.lines, { kind: "log", text: message, color: "err" }],
      })));
      throw error;
    }
  };
  const openOAuth = (providerId) => setOauth({ providerId });
  const handleProviderConnect = async (providerId) => {
    if (providerId === "codex" && agentAuthRuntimeService.hasRuntime()) {
      setSettingsOpen(false);
      setActiveProviderId("codex");
      try {
        await openRuntimeCodexLogin();
        const connection = await agentAuthRuntimeService.beginLogin("codex", CODEX_REQUIRED_SCOPES);
        applyProviderConnection(connection);
        if (connection.status !== "connected") {
          markProviderError("codex", connection.lastError || (
            lang === "ko"
              ? "Codex CLI 로그인을 완료한 뒤 다시 연결해야 해."
              : "Complete Codex CLI login, then reconnect."
          ));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        markProviderError("codex", message);
        pushProjectMessage(lang === "ko"
          ? `Codex 로그인을 시작하지 못했어: ${message}`
          : `Could not start Codex login: ${message}`);
      }
      return;
    }

    setSettingsOpen(false);
    openOAuth(providerId);
  };
  const onConnect = (id) => {
    setProviders((prev) => prev.map((p) => p.id === id
      ? { ...p, state: "connected", scope: ["files.read", "terminal.read", "exec.suggest"], expiresInDays: 30 }
      : p));
  };

  // flatten for sidebar
  const flatTabs = allTabs(workspace).map(({ tab, groupId }) => ({
    id: tab.id, title: tab.title, status: tab.status, cmd: tab.cmd, groupId,
  }));

  return (
    <>
      <div className="gtum-stage" ref={stageRef}>
        <div className={"gtum-scaler" + (maximized ? " is-max" : "")} ref={scalerRef}>
          <div
            className={"gtum-window os-" + os + " " + widthClass + (maximized ? " is-max" : "")}
            ref={windowRef}
          >
            <Titlebar
              lang={lang}
              os={os}
              maximized={maximized}
              workspace={workspace}
              providers={providers}
              project={activeProject}
              icons={Icon}
              translate={t}
              openSettings={() => setSettingsOpen(true)}
              onMinimize={onMinimize}
              onToggleMax={onToggleMax}
              onClose={onClose}
              onStartDrag={onStartDrag}
            />
            <div
              className={"body-grid" +
                (!sidebarOpen ? " sidebar-closed" : "") +
                (!agentOpen ? " agent-closed" : "")}
              style={{
                gridTemplateColumns:
                  (sidebarOpen ? sidebarWidth + "px 4px " : "") +
                  "minmax(0, 1fr)" +
                  (agentOpen ? " 4px " + agentWidth + "px" : ""),
              }}
            >
              {sidebarOpen && (
                <Sidebar
                  lang={lang}
                  project={activeProject}
                  openingProject={projectBusy}
                  collapseSidebar={() => setSidebarOpen(false)}
                  onOpenProject={handleOpenProject}
                  onOpenFile={handleOpenFile}
                />
              )}
              {sidebarOpen && (
                <div
                  className="resize-handle handle-left"
                  onPointerDown={startResize("left")}
                  title={lang === "ko" ? "끌어서 크기 조정" : "Drag to resize"}
                />
              )}
              <Workspace
                workspace={workspace}
                lang={lang}
                executing={executing}
                project={activeProject}
                sidebarOpen={sidebarOpen}
                openSidebar={() => setSidebarOpen(true)}
                agentOpen={agentOpen}
                openAgent={() => setAgentOpen(true)}
                actions={actions}
              />
              {agentOpen && (
                <div
                  className="resize-handle handle-right"
                  onPointerDown={startResize("right")}
                  title={lang === "ko" ? "끌어서 크기 조정" : "Drag to resize"}
                />
              )}
              {agentOpen && (
                <AgentPanel
                  lang={lang}
                  messages={messages}
                  isTyping={isTyping}
                  activeTab={activeTab || { title: "—", lines: [] }}
                  activePane={activeTab || { lines: [] }}
                  mode={mode}
                  setMode={setMode}
                  onSend={onSend}
                  onOpenApproval={requestApproval}
                  providers={providers}
                  collapseAgent={() => setAgentOpen(false)}
                  activeProviderId={activeProviderId}
                  activeModelId={activeModelId}
                  onSwitchModel={onSwitchModel}
                  onOpenSettings={() => setSettingsOpen(true)}
                  project={activeProject}
                />
              )}
            </div>
            <StatusBar
              lang={lang}
              mode={mode}
              workspace={workspace}
              project={activeProject}
              icons={Icon}
              translate={t}
            />
          </div>
        </div>
      </div>

      {approval && (
        <ApprovalModal
          lang={lang}
          suggestion={approval}
          tabs={flatTabs}
          project={activeProject}
          onClose={() => setApproval(null)}
          onApprove={onApprove}
        />
      )}

      {oauth && (
        <OAuthModal
          lang={lang}
          initialProvider={oauth.providerId || "codex"}
          onClose={() => setOauth(null)}
          onConnect={onConnect}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          lang={lang}
          providers={providers}
          accent={t_.accent}
          accentOptions={ACCENT_OPTIONS}
          mode={mode}
          parallelLimit={parallelLimit}
          approvalPolicy={approvalPolicy}
          autoApprovalLog={autoApprovalLog}
          streamResponses={streamResponses}
          onClose={() => setSettingsOpen(false)}
          onConnect={handleProviderConnect}
          onDisconnect={onDisconnect}
          onSwitchModel={onSwitchModel}
          onSetAccent={(v) => setTweak("accent", v)}
          onSetMode={(v) => { setMode(v); setTweak("modeDefault", v); }}
          onSetParallelLimit={setParallelLimit}
          onSetApprovalPolicy={setApprovalPolicy}
          onSetStreamResponses={setStreamResponses}
        />
      )}

      {toast && (
        <ApprovalToast
          lang={lang}
          toast={toast}
          onDismiss={() => setToast(null)}
          onUndo={() => {
            // Mark as undone in log
            setAutoApprovalLog((prev) => prev.map((e) =>
              e.id === toast.id ? { ...e, undone: true } : e));
            // Tell the user via chat
            setMessages((prev) => [...prev, {
              id: "undo-" + Date.now(),
              role: "assistant",
              roleLabel: lang === "ko" ? "운영자" : "Operator",
              at: nowHm(),
              content: lang === "ko"
                ? `방금 자동 실행한 \`${toast.cmd}\`을 되돌렸어 (시뮬레이션).`
                : `Reverted \`${toast.cmd}\` (simulated).`,
            }]);
            setToast(null);
          }}
        />
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection label={lang === "ko" ? "외관" : "Appearance"} />
        <TweakColor
          label={lang === "ko" ? "액센트 컬러" : "Accent color"}
          value={t_.accent}
          options={ACCENT_OPTIONS}
          onChange={(v) => setTweak("accent", v)}
        />
        <TweakSection label={lang === "ko" ? "언어" : "Language"} />
        <TweakRadio
          label={lang === "ko" ? "UI 언어" : "UI language"}
          value={t_.lang}
          options={[{ value: "ko", label: "한국어" }, { value: "en", label: "English" }]}
          onChange={(v) => setTweak("lang", v)}
        />
        <TweakSection label={lang === "ko" ? "실행 모드" : "Execution"} />
        <TweakRadio
          label={lang === "ko" ? "기본 모드" : "Default mode"}
          value={mode}
          options={[
            { value: "fast", label: "Fast" },
            { value: "balanced", label: "Bal" },
            { value: "deep", label: "Deep" },
          ]}
          onChange={(v) => { setMode(v); setTweak("modeDefault", v); }}
        />
      </TweaksPanel>
    </>
  );
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowHm() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function canned(input, lang, activeTab) {
  const s = input.toLowerCase();
  if (s.includes("test") || s.includes("테스트")) {
    return [
      { role: "assistant", roleLabel: lang === "ko" ? "테스터" : "Tester",
        content: lang === "ko"
          ? "tests 탭에서 `vitest`를 다시 돌렸어. funnel.spec.ts에서 `skipping optional step` 케이스가 60이 아니라 50이 나와야 한다는데, `useFunnelState.ts`의 진행률 계산이 optional step을 빼지 않고 있어."
          : "I reran `vitest`. `skipping optional step` expects 50 but got 60 — `useFunnelState.ts` doesn't exclude optional steps from progress." },
      { role: "assistant", roleLabel: lang === "ko" ? "코더" : "Coder",
        suggestion: {
          id: "sg-test",
          title: lang === "ko" ? "useFunnelState 진행률 계산 패치 후 재실행" : "Patch useFunnelState progress, rerun tests",
          commands: [{ cmd: "pnpm test:funnel --reporter=verbose", risk: "low", target: "t-tests" }],
          note: lang === "ko" ? "파일 수정은 아직 안 함 — 우선 재실행해서 실패 stack을 확인할 수 있음." : "No file edits yet — rerun first to inspect the failing stack.",
        }},
    ];
  }
  if (s.includes("explain") || s.includes("설명")) {
    const status = activeTab?.status || "idle";
    return [{
      role: "assistant", roleLabel: lang === "ko" ? "탐색자" : "Explorer",
      content: lang === "ko"
        ? `현재 [${activeTab?.title || "-"}] 탭 상태는 \`${status}\`. ${status === "failed" ? "오류 스택을 보면 listener가 이미 점유 중인 포트에 다시 바인딩하려고 함." : "정상 동작 중."}`
        : `Tab [${activeTab?.title || "-"}] is currently \`${status}\`. ${status === "failed" ? "Listener is trying to bind to a port already in use." : "Running normally."}`,
    }];
  }
  return [{
    role: "assistant", roleLabel: lang === "ko" ? "지휘자" : "Conductor",
    content: lang === "ko"
      ? "확인했어. 더 자세한 분석이 필요하면 mode를 Deep으로 올려서 다시 물어봐."
      : "Got it. Switch to Deep mode for a more thorough analysis.",
  }];
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
