import React from 'react'
import { createRoot } from 'react-dom/client'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
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
  CODEX_REQUIRED_SCOPES,
  createAgentAuthRuntimeService,
  providerViewStateFromConnection,
} from './shared/api/runtimeAgentAuth'
import { createAgentSuggestionRuntimeService } from './shared/api/runtimeAgentSuggestions'
import { createAgentJobRuntimeService } from './shared/api/runtimeAgentJobs'
import { createTerminalRuntimeService } from './shared/api/runtimeTerminals'
import { createWorkspaceRuntimeService } from './shared/api/runtimeWorkspace'
import { useProjectWorkspaces } from './features/projects/model/useProjectWorkspaces'
import { StatusBar } from './widgets/app-shell/ui/StatusBar'
import { Titlebar } from './widgets/app-shell/ui/Titlebar'
import { ProjectSwitcher } from './widgets/project-sidebar/ui/ProjectSwitcher'
import { initialOs, detectRuntimeOs } from './shared/lib/os/detectOs'
import '@xterm/xterm/css/xterm.css'
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
// ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

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

// ???? useTweaks ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
// Single source of truth for tweak values. setTweak persists via the host
// (__edit_mode_set_keys ??host rewrites the EDITMODE block on disk).
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
    // can react ??the parent message only reaches the host, not peers.
    window.dispatchEvent(new CustomEvent('tweakchange', { detail: edits }));
  }, []);
  return [values, setTweak];
}

// ???? TweaksPanel ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
// Floating shell. Registers the protocol listener BEFORE announcing
// availability ??if the announce ran first, the host's activate could land
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
                  onClick={dismiss}>x</button>
        </div>
        <div className="twk-body">
          {children}
        </div>
      </div>
    </>
  );
}

// ???? Layout helpers ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

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

// ???? Controls ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

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
  // of a drag ??ref it so a stale closure doesn't fire onChange for every move.
  const valueRef = React.useRef(value);
  valueRef.current = value;

  // Segments wrap mid-word once per-segment width runs out. The track is
  // ~248px (280 panel ??28 body pad ??4 seg pad), each button loses 12px
  // to its own padding, and 11.5px system-ui averages ~6.3px/char ??so 2
  // options fit ~16 chars each, 3 fit ~10. Past that (or >3 options), fall
  // back to a dropdown rather than wrap.
  const labelLen = (o) => String(typeof o === 'object' ? o.label : o).length;
  const maxLen = options.reduce((m, o) => Math.max(m, labelLen(o)), 0);
  const fitsAsSegments = maxLen <= ({ 2: 16, 3: 10 }[options.length] ?? 0);
  if (!fitsAsSegments) {
    // <select> emits strings ??map back to the original option value so the
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

// Relative-luminance contrast pick ??checkmarks drawn over a swatch need to
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

// TweakColor ??curated color/palette picker. Each option is either a single
// hex string or an array of 1-5 hex strings; the card adapts ??a lone color
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
                    aria-label={colors.join(', ')} title={colors.join(' /')}
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
// data.jsx ??scenario data, i18n strings, icons

const STR = {
  ko: {},
  en: {
    activeAgent: "active agent",
    addDir: "Add directory",
    addPattern: "Add pattern",
    agentChat: "Agent",
    approvalLevel: "Approval level",
    approvalPolicy: "Approval policy",
    auditTrail: "Audit trail",
    autoApproveLog: "Recent auto-approvals",
    autoApproveLow: "Auto-approve low risk",
    autoRanInline: "Low risk auto-ran",
    aboutContext: "Context",
    approve: "Approve",
    blockedByPattern: "Blocked by pattern",
    branch: "Branch",
    changes: "changes",
    closeTab: "Close tab",
    collapseAgent: "Collapse agent",
    collapseSidebar: "Collapse sidebar",
    commandHistory: "Command history",
    conductor: "Codex",
    connect: "Connect",
    connected: "Connected",
    connectDetails: "Connect a provider to enable runtime-backed requests.",
    connectIntro: "Choose a provider and complete the desktop login flow.",
    connectProvider: "Connect provider",
    connectSuccess: "connected",
    contextFiles: "Selected file",
    contextTab: "Current tab",
    ctxClose: "Close",
    ctxCloseAll: "Close All",
    ctxCloseLeft: "Close to the Left",
    ctxCloseOthers: "Close Others",
    ctxCloseRight: "Close to the Right",
    ctxMoveDown: "Move into New Group Down",
    ctxMoveRight: "Move into New Group Right",
    ctxNewGroup: "Move into New Group",
    ctxSplitDown: "Split Down",
    ctxSplitLeft: "Split Left",
    ctxSplitRight: "Split Right",
    ctxSplitUp: "Split Up",
    days: " days",
    detach: "Detach",
    attach: "Attach",
    disconnect: "Disconnect",
    emptyGroup: "Drag a tab here, or open a real project",
    expandAgent: "Expand agent",
    expandSidebar: "Expand sidebar",
    explain: "Explain current state",
    failed: "failed",
    forbiddenPatterns: "Forbidden patterns",
    forbiddenPatternsHint: "Always confirm these regardless of policy",
    high: "High",
    idle: "idle",
    low: "Low",
    mergeToSingle: "Merge to single",
    mid: "Medium",
    needsApproval: "Needs review",
    permissionRequest: "Permission request",
    decisionNeeded: "Decision needed",
    chooseOneOption: "Choose one option",
    selected: "Selected",
    terminalCommandReview: "Terminal command needs review",
    commandPreview: "Command preview",
    allowOnce: "Allow once",
    alwaysAllow: "Always allow",
    permissionDeny: "Deny",
    allowedOnce: "Allowed once",
    alwaysAllowed: "Always allowed",
    denied: "Denied",
    permissionAllowedOnce: "Permission allowed once. Decision kept in the agent panel.",
    permissionAlwaysAllowed: "Always-allow recorded. Decision kept in the agent panel.",
    permissionDenied: "Permission denied in the agent panel. I will not run terminal commands.",
    executionSuggestion: "Execution suggestion",
    projectScope: "Project scope",
    commandCount: "command",
    commandCountPlural: "commands",
    decisionReviewing: "Reviewing",
    reason: "Reason",
    riskHigh: "high risk",
    riskLow: "low risk",
    riskMid: "medium risk",
    newTab: "New tab",
    newTabHere: "New tab here",
    noAutoApprovals: "No commands auto-approved yet",
    noConnectedProviders: "No providers connected",
    nowExecuting: "Executing",
    openProjectFolder: "Open project folder",
    passing: "passing",
    presetBold: "Bold",
    presetCautious: "Cautious",
    presetCustom: "Custom",
    presetDefault: "Default",
    requiresHigher: "This command needs explicit approval at its risk level",
    review: "Review command",
    reviewBeforeRun: "Review in agent panel",
    revert: "Revert",
    riskHighDesc: "Destructive commands and production deploys",
    riskHighFull: "High-risk commands",
    riskLowDesc: "Reads, builds, and tests",
    riskLowFull: "Low-risk commands",
    riskMidDesc: "Killing processes, installing packages, clearing caches",
    riskMidFull: "Medium-risk commands",
    running: "running",
    saveSettings: "Save",
    sendCtx: "send context",
    sessionExpiry: "Session expires in ",
    settingsAbout: "About",
    settingsAppearance: "Appearance",
    settingsConnections: "Agent connections",
    settingsExecution: "Execution",
    settingsTitle: "Settings",
    statusBarHint: "Command palette",
    statusReady: "Ready",
    streamResponses: "Stream responses",
    streamResponsesHint: "Stream agent replies character by character",
    suggestFix: "Suggest a fix",
    suggestedActions: "suggested actions",
    tabsLabel: "tabs",
    tasks: "Tasks",
    typing: "typing",
    activityPreparing: "Preparing context",
    activityRequesting: "Requesting Codex",
    activityWaiting: "Waiting for runtime",
    activityFinalizing: "Preparing response",
    toastAutoRan: "Auto-ran",
    keepInAgent: "Keep in agent",
    terminalRunHint: "Approval records the decision in the Agent panel; terminal execution remains user-owned.",
    decisionKept: "Decision kept in the agent panel.",
    trustedDirs: "Trusted directories",
    trustedDirsHint: "Auto-approve only applies inside these paths",
    typeMessage: "Ask Codex",
    undo: "Undo",
    waitingCallback: "Waiting for callback",
    workspaceTitle: "Open a project",
    you: "You"
  },
};
const t = (lang, key) => (STR[lang] && STR[lang][key]) || STR.en[key] || key;

const PROJECT = {
  name: "Open a project",
  path: "",
  branch: "no-project",
  branchType: "none",
  ahead: 0,
  behind: 0,
  changedFiles: 0,
  runtimeBacked: false,
  fileTree: [],
};

async function selectRuntimeProjectFolder(defaultPath, runtimeAvailable = hasTauriRuntime()) {
  const pickerOverride = typeof window === "undefined"
    ? null
    : window.__GTUM_PROJECT_FOLDER_PICKER__;
  if (pickerOverride?.pick) {
    return pickerOverride.pick({ defaultPath });
  }

  if (!hasTauriRuntime()) {
    return runtimeAvailable ? (defaultPath || PROJECT.path || ".") : null;
  }

  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: "Choose a project folder",
    defaultPath: defaultPath || undefined,
  });

  return typeof selected === "string" ? selected : null;
}

// Start from a real empty workbench. Runtime-backed project, file, terminal,
// chat, task, and history data are populated only after the desktop app opens
// a local project or receives an explicit runtime response.
const WORKSPACE_INITIAL = {
  layoutTree: { type: "group", groupId: "g-empty" },
  activeGroupId: "g-empty",
  groups: {
    "g-empty": {
      id: "g-empty",
      activeTabId: null,
      tabs: [],
    },
  },
};

const PROVIDERS_INIT = [
  {
    id: "codex",
    label: "Codex",
    abbr: "Cx",
    state: "disconnected",
    scope: [],
    expiresInDays: null,
  },
  {
    id: "claude",
    label: "Claude",
    abbr: "Cl",
    state: "disconnected",
    scope: [],
    expiresInDays: null,
  },
];

const CHAT_INIT = () => [];
const COMMAND_HISTORY_INIT = [];
const TASKS_INIT = () => [];
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
  stop: (props) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...props}>
      <rect x="4" y="4" width="6" height="6" rx="1.2" fill="currentColor" />
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

// Derive a status badge for a whole group from its tabs ??worst-status wins.
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
// Active tab of the active group ??used by the agent context summary, etc.
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

// File content for editor tabs ??keyed by full path in the file tree.
const FILE_CONTENTS = {};
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
    contentHash: null,
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
const agentJobRuntimeService = createAgentJobRuntimeService();
const terminalRuntimeService = createTerminalRuntimeService();
const workspaceRuntimeService = createWorkspaceRuntimeService();

function agentAttachmentPickerOverride() {
  if (typeof window === "undefined") return null;
  return window.__GTUM_AGENT_ATTACHMENT_PICKER__ || null;
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function labelFromPath(path) {
  const parts = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) || String(path || "attachment");
}

function normalizePickedAgentAttachment(value, fallbackKind) {
  if (typeof value === "string") {
    return {
      kind: fallbackKind,
      path: value,
      label: labelFromPath(value),
    };
  }

  if (!value || !value.path) return null;
  return {
    kind: value.kind || fallbackKind,
    path: value.path,
    label: value.label || labelFromPath(value.path),
  };
}

async function pickAgentAttachments(providerCapabilities) {
  const enabled = (providerCapabilities?.attachments || []).filter((attachment) => attachment.enabled);
  const capability = enabled.find((attachment) => attachment.kind === "image")
    || enabled.find((attachment) => attachment.kind === "file")
    || enabled.find((attachment) => attachment.kind === "directory");
  if (!capability) return [];

  const override = agentAttachmentPickerOverride();
  if (override?.pick) {
    const picked = await override.pick({ capability, capabilities: enabled });
    return toArray(picked)
      .map((value) => normalizePickedAgentAttachment(value, capability.kind))
      .filter(Boolean);
  }

  if (!hasTauriRuntime()) return [];

  const selected = await openDialog({
    multiple: true,
    directory: capability.kind === "directory",
    filters: capability.kind === "image"
      ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }]
      : undefined,
  });

  return toArray(selected)
    .map((value) => normalizePickedAgentAttachment(value, capability.kind))
    .filter(Boolean);
}

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

async function saveRuntimeProjectFile(project, fileTab) {
  return projectRuntimeService.saveProjectFile(project, fileTab);
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

// Lightweight syntax tokenizer for TS/TSX ??keyword, string, comment, number.
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

// ???? Approval policy ??????????????????????????????????????????????????????????????????????????????????????????????????????????
//
// Policy decides whether a command is auto-approved or routed through the
// approval modal. We model 3 risk levels with separate rules + an absolute
// allowlist (trusted dirs) and denylist (forbidden patterns).
//
// Preset semantics:
//   cautious ??every command always asks; no shortcuts.
//   default  ??every command asks; no automatic terminal execution.
//   bold     ??every command asks; no automatic terminal execution.
//
// Forbidden patterns are checked first and always force "always-ask",
// even if the policy would auto-approve. High-risk is hard-coded to
// always-ask ??you cannot disable it.
const APPROVAL_PRESETS = {
  cautious: { lowRisk: "always-ask", midRisk: "always-ask" },
  default:  { lowRisk: "always-ask", midRisk: "always-ask" },
  bold:     { lowRisk: "always-ask", midRisk: "always-ask" },
};

const APPROVAL_POLICY_INIT = {
  preset: "default",
  lowRisk: "always-ask",
  midRisk: "always-ask",
  // highRisk is always "always-ask" ??not stored, just enforced.
  trustedDirs: [],
  forbiddenPatterns: ["rm -rf", "git push --force", "sudo", "dd if="],
};

// Decide what to do with a command:
//   { action: 'auto' } ??execute without modal
//   { action: 'ask', reason }  ??open approval modal
function policyDecideForCommand(policy, cmd, risk, cwd) {
  const text = cmd || "";
  // 1. Forbidden patterns override everything
  for (const pat of policy.forbiddenPatterns) {
    if (text.toLowerCase().includes(pat.toLowerCase())) {
      return { action: "ask", reason: "forbidden", pattern: pat };
    }
  }
  // 2. High risk ??always ask
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

// Whole-suggestion decision. The active Codex flow records approvals in the
// Agent panel instead of executing commands through this legacy policy path.
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
// workspace-store.jsx ??pure functions for VS Code-style workspace state.
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
// Every exported action is a pure function: (state, ...args) ??newState.

// ???? id helpers ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
let __gtumIdCounter = 0;
function uid(prefix) {
  __gtumIdCounter += 1;
  // Time + counter avoids collisions even within the same millisecond.
  return prefix + "-" + Date.now().toString(36) + "-" + __gtumIdCounter;
}

// ???? tree utils ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

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

// ???? pure actions ????????????????????????????????????????????????????????????????????????????????????????????????????????????????

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
      // workspace must keep at least one group ??restore a fresh empty one
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
// 'right' | 'left' | 'down' | 'up' ??relative to `groupId`.
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
      // Source group would become empty ??that's a degenerate split. Just move active.
      // Better UX: bail (no-op) ??caller should detect and use moveTab instead.
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

  // Same group + dropping a tab from a single-tab group on its own edge ??no-op
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

// openFile ??open a file as an editor tab in the active group.
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
// sidebar.jsx ??VS Code-style two-section accordion:
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

const WORKSPACE_CODENAME_STEMS = [
  "ridge",
  "harbor",
  "orbit",
  "signal",
  "vector",
  "summit",
];

function workspaceCodename(index) {
  const stem = WORKSPACE_CODENAME_STEMS[(Math.max(1, index) - 1) % WORKSPACE_CODENAME_STEMS.length];
  const cycle = Math.floor((Math.max(1, index) - 1) / WORKSPACE_CODENAME_STEMS.length);
  return cycle > 0 ? `${stem}-${cycle + 1}` : stem;
}

function agentSessionStatusView(session) {
  const messages = session?.messages || [];
  const hasRunning = messages.some((message) => message.progress?.status === "running");
  if (hasRunning) {
    return {
      id: "working",
      label: "Working",
      note: "Provider request in progress",
    };
  }

  const hasPendingPermission = messages.some((message) =>
    message.suggestion?.commands?.length > 0 && !message.permissionDecision);
  if (hasPendingPermission) {
    return {
      id: "review",
      label: "Review needed",
      note: "Command approval is waiting",
    };
  }

  const hasFinishedWork = messages.some((message) =>
    message.answerMeta || message.permissionDecision || message.completed);
  if (hasFinishedWork) {
    return {
      id: "done",
      label: "Done",
      note: "Latest request finished",
    };
  }

  return {
    id: "waiting",
    label: "Waiting",
    note: "Ready for a request",
  };
}

function ProjectWorkspaceGroup({
  project,
  agentWorkspace,
  activeAgentSessionId,
  activeProvider,
  onSelectAgentSession,
  onNewAgentSession,
  onCloseAgentSession,
}) {
  const sessions = agentWorkspace?.sessions || [];
  const provider = activeProvider || PROVIDERS_INIT[0];

  return (
    <div className="pg-body">
      <div className="project-workspace-toolbar">
        <span className="project-workspace-label">Agent workspaces</span>
        <span className="pg-count">{sessions.length}</span>
        <button
          className="project-workspace-new"
          type="button"
          title="New workspace"
          onClick={onNewAgentSession}
        >
          <Icon.plus />
        </button>
      </div>
      {sessions.map((session) => {
          const status = agentSessionStatusView(session);
          const active = session.id === activeAgentSessionId;

          return (
            <button
              className={`ws-item ws-${status.id}${active ? " active" : ""}`}
              key={session.id}
              type="button"
              onClick={() => onSelectAgentSession(session.id)}
            >
              <span className={`ws-state-rail ${status.id}`} />
              <span className={"ws-mark provider-mark " + provider.id}>{provider.abbr}</span>
              <span className="ws-info">
                <span className="ws-top">
                  <span className="ws-name">{session.title}</span>
                  <span className={`ws-status ${status.id}`}>
                    <span className="ws-dot" />
                    {status.label}
                  </span>
                </span>
                <span className="ws-meta">
                  <span className="ws-branch">{project.branch}</span>
                  {project.changedFiles > 0 && (
                    <>
                      <span className="ws-sep">/</span>
                      <span className="ws-changed">{project.changedFiles} changes</span>
                    </>
                  )}
                </span>
                <span className="ws-note">{status.note}</span>
              </span>
              {sessions.length > 1 && (
                <span
                  className="ws-remove"
                  role="button"
                  tabIndex={0}
                  title={`Delete ${session.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onCloseAgentSession(session.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    onCloseAgentSession(session.id);
                  }}
                >
                  <Icon.x />
                </span>
              )}
            </button>
          );
      })}
    </div>
  );
}

function Sidebar({
  lang, project, openingProject, collapseSidebar, onOpenFile, onOpenProject,
  projectRows, activeProjectPath, onSelectProject,
  agentWorkspace, activeAgentSessionId, activeProvider,
  onSelectAgentSession, onNewAgentSession, onCloseAgentSession,
}) {
  const [selectedFile, setSelectedFile] = React.useState(null);
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
        <span className="sb-title">{"Explorer"}</span>
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
          label={"Projects"}
          count={projectRows.length}
          open={projectsOpen}
          onToggle={() => setProjectsOpen((v) => !v)}
        >
          <ProjectSwitcher
            rows={projectRows}
            activePath={activeProjectPath}
            openingProject={openingProject}
            openProjectLabel={t(lang, "openProjectFolder")}
            openingProjectLabel="Opening project"
            openProjectHint="Open a local folder as a workspace"
            onSelectProject={onSelectProject}
            onOpenProject={onOpenProject}
            plusIcon={<Icon.plus />}
            branchIcon={<Icon.branch />}
            activeDetails={activeProject.runtimeBacked ? (
              <ProjectWorkspaceGroup
                project={activeProject}
                agentWorkspace={agentWorkspace}
                activeAgentSessionId={activeAgentSessionId}
                activeProvider={activeProvider}
                onSelectAgentSession={onSelectAgentSession}
                onNewAgentSession={onNewAgentSession}
                onCloseAgentSession={onCloseAgentSession}
              />
            ) : null}
          />
        </Section>

        <Section
          label={"Files"}
          count={activeProject.changedFiles > 0
            ? `${activeProject.changedFiles} ${"changed"}`
            : null}
          open={filesOpen}
          onToggle={() => setFilesOpen((v) => !v)}
        >
          {activeProject.fileTree.length > 0 ? activeProject.fileTree.map((n, i) =>
            <FileTreeNode key={i} node={n} depth={0} lang={lang}
              onSelect={handleFileClick}
              selected={selectedFile} />
          ) : (
            <div className="empty-mini">
              {"Open a real project folder in the desktop app."}
            </div>
          )}
        </Section>
      </div>
    </aside>
  );
}

Object.assign(window, { Sidebar });


// ----- src/workspace.jsx -----
// workspace.jsx ??VS Code-style workspace UI.
// Renders the layout tree, each leaf is a Group (own tabbar + content),
// each split is a SplitNode (children + drag-resize divider).

const DROP_EDGE_RATIO = 0.18; // top/right/bottom/left ~ 18% wide each
const MIN_PANE_PCT = 8;       // minimum % of a child after resizing

// ???? Code editor view ????????????????????????????????????????????????????????????????????????????????????????????????????????
function CodeEditor({ tab, onChangeFile }) {
  const lines = (tab.content || "").split("\n");
  return (
    <div className="editor-body">
      <div className="editor-gutter">
        {lines.map((_, i) => (
          <div key={i} className="editor-ln">{i + 1}</div>
        ))}
      </div>
      <textarea
        className="editor-textarea"
        value={tab.content || ""}
        spellCheck={false}
        disabled={tab.isText === false}
        onChange={(event) => onChangeFile?.(tab.id, event.target.value)}
      />
    </div>
  );
}

// ???? Tab body ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
function TabBody({ tab, onChangeFile }) {
  if (!tab) return null;
  if (tab.type === "editor") return <CodeEditor tab={tab} onChangeFile={onChangeFile} />;
  return <TerminalBody tab={tab} />;
}

// Live xterm.js terminal wired to the runtime PTY session. Reads raw output
// incrementally via readRawOutput and forwards keystrokes via writeInput.
function XtermTerminal({ owner }) {
  const containerRef = React.useRef(null);
  const projectPath = owner?.projectPath;
  const terminalSessionId = owner?.terminalSessionId;

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const capturedOwner = { projectPath, terminalSessionId };

    let disposed = false;
    let from = 0;
    let interval = null;

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily:
        '"Geist Mono", "JetBrains Mono", "SF Mono", ui-monospace, monospace',
      fontSize: 12,
      theme: { background: "#0a0c10", foreground: "#e6e6e6" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    const safeFit = () => {
      try {
        fitAddon.fit();
      } catch {
        return; /* container not measurable yet */
      }
      // Match the PTY size to the xterm viewport so the shell's line editor
      // (backspace, cursor moves, prompt redraw) uses the correct width and
      // does not overwrite earlier output.
      void terminalRuntimeService.resizeSession(capturedOwner, term.rows, term.cols);
    };

    safeFit();
    term.focus();

    const dataSub = term.onData((data) => {
      void terminalRuntimeService.writeInput(capturedOwner, data);
    });

    const pump = async () => {
      try {
        const output = await terminalRuntimeService.readRawOutput(capturedOwner, from);
        if (disposed) return;
        if (output.chunk) {
          term.write(output.chunk);
          from = output.cursor;
        } else if (typeof output.cursor === "number" && output.cursor < from) {
          // Buffer reset (session recycled); replay from the new start.
          from = output.cursor;
        }
      } catch {
        /* transient runtime read failure; retry on next tick */
      }
    };

    void pump();
    interval = window.setInterval(() => {
      void pump();
    }, 60);

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => safeFit())
        : null;
    observer?.observe(container);

    return () => {
      disposed = true;
      if (interval != null) window.clearInterval(interval);
      observer?.disconnect();
      dataSub.dispose();
      term.dispose();
    };
  }, [projectPath, terminalSessionId]);

  return <div className="term-xterm" ref={containerRef} />;
}

function TerminalBody({ tab }) {
  const bodyRef = React.useRef(null);
  const hasProjectOwner = typeof tab.projectPath === "string" && tab.projectPath.trim().length > 0;
  const runtimeBacked = Boolean(
    tab.runtimeBacked && hasProjectOwner && tab.terminalSessionId != null
  );
  const terminalOwner = React.useMemo(() => ({
    projectPath: tab.projectPath,
    terminalSessionId: tab.terminalSessionId,
  }), [tab.projectPath, tab.terminalSessionId]);

  React.useEffect(() => {
    if (!runtimeBacked && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [runtimeBacked, tab?.id, tab?.lines?.length]);

  if (runtimeBacked) {
    return (
      <div className="terminal-surface">
        <XtermTerminal owner={terminalOwner} />
      </div>
    );
  }

  return (
    <div className="terminal-surface">
      <div className="tab-body" ref={bodyRef}>
        {tab.lines.map((ln, i) => (
          <div key={i} className={"term-line " + (ln.kind === "cmd" ? "cmd" : (ln.color || ""))}>
            {ln.text}
          </div>
        ))}
        <div className="term-line dim">Open a runtime-backed terminal in the desktop app to type here.</div>
      </div>
    </div>
  );
}

// ???? Empty group placeholder ??????????????????????????????????????????????????????????????????????????????????????????
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

// ???? Right-click context menu ????????????????????????????????????????????????????????????????????????????????????????
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

// ???? Group tabbar ????????????????????????????????????????????????????????????????????????????????????????????????????????????????
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

// ???? Group (tabbar + content area) ??????????????????????????????????????????????????????????????????????????????
function Group({
  group, isActive, lang, executing, project,
  onSetActiveTab, onCloseTab, onNewTab,
  onReorderTab, onDropTabFromAnother, onDropTabOnEdge,
  onTabContextMenu, onFocusGroup,
  onChangeFile, onSaveFile,
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
                <span className="sep">/</span>
                <span className="cmd">{activeTab.cmd || "--"}</span>
                <span className={"badge " + activeTab.status}>{t(lang, activeTab.status)}</span>
              </div>
            )}
            {activeTab.type === "editor" && (
              <div className="group-status editor-status">
                <span className="cwd">{activeTab.displayPath || activeTab.path}</span>
                {activeTab.dirty && <span className="dirty-dot" />}
                <span className="sep">/</span>
                <span className="cmd">{activeTab.lang}</span>
                <button
                  className="group-status-action"
                  type="button"
                  disabled={!activeTab.dirty || activeTab.isText === false || activeTab.truncated}
                  onClick={() => onSaveFile?.(activeTab)}
                >
                  Save
                </button>
              </div>
            )}
            <TabBody
              tab={activeTab}
              onChangeFile={onChangeFile}
            />
          </>
        ) : (
          <EmptyGroup lang={lang} onNewTab={() => onNewTab(group.id)} />
        )}
        {executing && isActive && (
          <div className="run-banner">
            <span className="spin" />
            <span>{t(lang, "nowExecuting")}</span>
            <span style={{ color: "var(--text-dim)" }}>/{executing}</span>
          </div>
        )}
        {edge && (
          <div className="group-drop-overlay" aria-hidden>
            <div className={"group-drop-zone " + edge} />
            {edge !== "center" && (
              <div className="group-drop-label">{`Split ${edge}`}</div>
            )}
            {edge === "center" && (
              <div className="group-drop-label center">
                {"Add to this group"}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ???? Split node ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
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
      // Keep localSizes ??clearing it would revert to node.sizes (the initial value)
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

// ???? Layout node dispatcher ????????????????????????????????????????????????????????????????????????????????????????????
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

// ???? Workspace root ????????????????????????????????????????????????????????????????????????????????????????????????????????????
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
    onChangeFile: actions.changeFile,
    onSaveFile: actions.saveFile,
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
// agent.jsx ??right pane: chat-centric agent panel

function providerSessionLabel(provider) {
  if (!provider) return "No provider";
  if (provider.state === "connected") return "CLI session";
  if (provider.state === "pending") return "Checking login";
  if (provider.state === "error") return "Needs attention";

  return "Connect provider";
}

function formatReasoningLevelLabel(level) {
  const normalized = String(level || "").trim();
  if (!normalized) return "Default";
  const lower = normalized.toLowerCase();
  if (lower === "xhigh" || lower === "x_high" || lower === "extra_high") return "XHigh";
  if (lower === "low") return "Low";
  if (lower === "medium") return "Medium";
  if (lower === "high") return "High";

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function providerReasoningLevels(providerCapabilities) {
  return (providerCapabilities?.reasoningLevels || [])
    .filter((level) => String(level?.level || "").trim().length > 0);
}

function reasoningLevelCapability(providerCapabilities, selectedLevel) {
  const normalized = String(selectedLevel || "").trim();
  if (!normalized) return null;

  return providerReasoningLevels(providerCapabilities)
    .find((level) => level.level === normalized) || null;
}

function reasoningLevelLabel(providerCapabilities, selectedLevel) {
  return reasoningLevelCapability(providerCapabilities, selectedLevel)?.label
    || formatReasoningLevelLabel(selectedLevel);
}

function normalizeReasoningLevel(providerCapabilities, selectedLevel) {
  const levels = providerReasoningLevels(providerCapabilities);
  if (levels.length === 0) return null;

  const selected = String(selectedLevel || "").trim();
  if (selected && levels.some((level) => level.level === selected)) return selected;

  const preferred = String(providerCapabilities?.defaultReasoningLevel || "").trim();
  if (preferred && levels.some((level) => level.level === preferred)) return preferred;

  return levels[0].level;
}

function nextReasoningLevel(providerCapabilities, selectedLevel) {
  const levels = providerReasoningLevels(providerCapabilities);
  if (levels.length === 0) return null;

  const current = normalizeReasoningLevel(providerCapabilities, selectedLevel);
  const currentIndex = levels.findIndex((level) => level.level === current);
  return levels[(currentIndex + 1) % levels.length]?.level || levels[0].level;
}

function selectedAgentModel(providerCapabilities, selectedModelId, activeProvider) {
  const availableModels = providerCapabilities?.availableModels || [];
  return availableModels.find((model) => model.modelId === selectedModelId)
    || providerCapabilities?.currentModel
    || {
      modelId: null,
      label: activeProvider ? `${activeProvider.label} default` : "Default model",
    };
}

function agentWorkspaceKey(project) {
  return project?.runtimeBacked && project.path ? project.path : "no-project";
}

function agentWorkspaceTitle(project) {
  return project?.runtimeBacked && project.name ? project.name : "No workspace";
}

function makeAgentSession(project, lang, index) {
  return {
    id: uid("agent"),
    title: workspaceCodename(index),
    workspaceKey: agentWorkspaceKey(project),
    workspaceTitle: agentWorkspaceTitle(project),
    createdAt: nowHm(),
    updatedAt: nowHm(),
    messages: CHAT_INIT(lang),
    reasoningLevel: null,
    fastMode: false,
  };
}

function ensureAgentWorkspace(store, project, lang) {
  const key = agentWorkspaceKey(project);
  if (store[key]?.sessions?.length) return store;

  const session = makeAgentSession(project, lang, 1);
  return {
    ...store,
    [key]: {
      workspaceKey: key,
      workspaceTitle: agentWorkspaceTitle(project),
      activeSessionId: session.id,
      sessions: [session],
    },
  };
}

function AgentHeader({
  lang,
  activeProvider, providerCapabilities, selectedModelId,
  agentWorkspace, activeAgentSession,
  onOpenSettings, collapseAgent,
}) {
  const model = selectedAgentModel(providerCapabilities, selectedModelId, activeProvider);
  const workspaceLabel = agentWorkspace?.workspaceTitle || "No workspace";
  const sessionLabel = activeAgentSession?.title || "Agent 1";

  return (
    <div className="agent-header">
      <div className={"provider-mark " + activeProvider.id}>
        {activeProvider.abbr}
      </div>
      <div className="agent-model-main">
        <div className="agent-model-name">
          <span>{model.label}</span>
          <Icon.chevronDown />
        </div>
        <div className="agent-model-sub">
          <span>{activeProvider.label}</span>
          <span>{providerSessionLabel(activeProvider)}</span>
          <span>{workspaceLabel} / {sessionLabel}</span>
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
  );
}

function AgentSessionTabs({
  agentWorkspace, activeSessionId,
  onSelectSession, onNewSession, onCloseSession,
}) {
  const sessions = agentWorkspace?.sessions || [];

  return (
    <div className="agent-session-strip" aria-label="Agent sessions">
      <div className="agent-session-tabs">
        {sessions.map((session) => (
          <button
            className={"agent-session-tab" + (session.id === activeSessionId ? " active" : "")}
            key={session.id}
            type="button"
            onClick={() => onSelectSession(session.id)}
          >
            <span>{session.title}</span>
            <small>{session.messages.length}</small>
            {sessions.length > 1 && (
              <span
                className="agent-session-close"
                role="button"
                tabIndex={0}
                title={`Close ${session.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseSession(session.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseSession(session.id);
                }}
              >
                <Icon.x />
              </span>
            )}
          </button>
        ))}
      </div>
      <button
        className="agent-session-new"
        type="button"
        title="New agent session"
        onClick={onNewSession}
      >
        <Icon.plus />
      </button>
    </div>
  );
}

function riskLabel(lang, risk) {
  const key = "risk" + risk[0].toUpperCase() + risk.slice(1);
  return t(lang, key);
}

function commandCountLabel(lang, count) {
  const noun = count === 1 ? t(lang, "commandCount") : t(lang, "commandCountPlural");
  return `${count} ${noun}`;
}

function commandTargetLabel(command) {
  return command.target === "new" ? "new terminal tab" : `[${command.target.replace("t-", "")}]`;
}

function providerRuntimeLabel(providerId) {
  if (providerId === "codex") return "Codex CLI";
  if (providerId === "claude") return "Claude";
  return "provider";
}

function progressStepLabel(lang, step) {
  if (typeof step === "string") return t(lang, step);
  return step?.label || "";
}

function progressStepDetail(step) {
  if (typeof step === "string") return null;
  return step?.detail || null;
}

function progressStepKey(step, index) {
  if (typeof step === "string") return step;
  return step?.id || step?.label || String(index);
}

function formatElapsedMs(elapsedMs) {
  const seconds = Math.max(0, Math.round((Number(elapsedMs) || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function makeAgentAnswerMeta(startedAtMs) {
  const answeredAtMs = Date.now();
  return {
    answeredAt: nowHmAt(answeredAtMs),
    elapsedMs: answeredAtMs - startedAtMs,
  };
}

function parseNumberedChoiceEvent(content) {
  const text = String(content || "").trim();
  if (!text) return null;

  const optionPattern = /(^|\s)(\d{1,2})[.)]\s+([\s\S]*?)(?=(?:\s+\d{1,2}[.)]\s+)|$)/g;
  const matches = [];
  let match;

  while ((match = optionPattern.exec(text)) !== null) {
    const leading = match[1] || "";
    const start = match.index + leading.length;
    const optionNumber = Number(match[2]);
    const label = match[3].trim();

    if (!Number.isFinite(optionNumber) || !label) continue;
    matches.push({
      id: String(optionNumber),
      label,
      start,
    });
  }

  if (matches.length < 2) return null;
  if (!matches.every((option, index) => Number(option.id) === index + 1)) return null;

  const prompt = text.slice(0, matches[0].start).trim();

  return {
    type: "choice",
    prompt,
    options: matches.map((option) => ({
      id: option.id,
      label: option.label,
    })),
    selectedOptionId: null,
  };
}

function agentProgressStageDelayMs() {
  const configuredDelay = typeof window !== "undefined"
    ? Number(window.__GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__)
    : NaN;

  if (Number.isFinite(configuredDelay) && configuredDelay >= 0) {
    return configuredDelay;
  }

  return 180;
}

function waitForAgentProgressStage() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, agentProgressStageDelayMs());
  });
}

function makeCodexProgressSteps({
  project, activeTab, providerId, model, attachments, reasoningLabel, fastMode,
}) {
  const runtimeLabel = providerRuntimeLabel(providerId);
  const projectName = project?.name || "project";
  const tabTitle = activeTab?.title || "no active tab";
  const modelLabel = model || "runtime default model";
  const attachmentCount = attachments?.length || 0;
  const displayedReasoningLabel = reasoningLabel || "runtime default";

  return [
    {
      id: "context",
      label: `Reading ${projectName} context`,
      detail: `Active tab: ${tabTitle}`,
    },
    {
      id: "request",
      label: `Sending request to ${runtimeLabel} runtime`,
      detail: `Model: ${modelLabel} / reasoning: ${displayedReasoningLabel} / fast: ${fastMode ? "on" : "off"} / attachments: ${attachmentCount}`,
    },
    {
      id: "waiting",
      label: `Waiting for ${runtimeLabel} response`,
      detail: "Desktop runtime is processing the request",
    },
  ];
}

function highestSuggestionRisk(suggestion) {
  if (suggestion.commands.some((command) => command.risk === "high")) return "high";
  if (suggestion.commands.some((command) => command.risk === "mid")) return "mid";
  return "low";
}

function AgentChoiceEvent({ lang, event, onChoose }) {
  const selectedOptionId = event.selectedOptionId || null;

  return (
    <div className="agent-event-card choice">
      <div className="agent-event-head">
        <div className="agent-event-icon">
          <Icon.spark />
        </div>
        <div className="agent-event-title">
          <span>{t(lang, "decisionNeeded")}</span>
          <strong>{t(lang, "chooseOneOption")}</strong>
        </div>
        {selectedOptionId && <span className="agent-event-state">{t(lang, "selected")}</span>}
      </div>
      <div className="agent-choice-options">
        {event.options.map((option) => {
          const selected = selectedOptionId === option.id;
          return (
            <button
              className={"agent-choice-option" + (selected ? " selected" : "")}
              disabled={Boolean(selectedOptionId)}
              key={option.id}
              onClick={() => onChoose(option)}
              type="button"
            >
              <span className="agent-choice-index">{option.id}</span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function permissionDecisionLabel(lang, status) {
  if (status === "allow_once") return t(lang, "allowedOnce");
  if (status === "always_allow") return t(lang, "alwaysAllowed");
  if (status === "denied") return t(lang, "denied");
  return null;
}

function AgentCommandActivity({ lang, suggestion, risk, permissionDecision }) {
  const decisionStatus = permissionDecision?.status || null;
  const decisionLabel = permissionDecisionLabel(lang, decisionStatus);

  return (
    <div className="agent-command-activity" data-risk={risk}>
      <div className="agent-command-activity-icon">
        <Icon.spark />
      </div>
      <div className="agent-command-activity-main">
        <div className="agent-command-activity-kicker">{t(lang, "executionSuggestion")}</div>
        <div className="agent-command-activity-title">{suggestion.title}</div>
        <div className="agent-turn-meta">
          <span>{commandCountLabel(lang, suggestion.commands.length)}</span>
          <span className={"risk " + risk}>{riskLabel(lang, risk)}</span>
          <span className="agent-status-badge">{decisionLabel || t(lang, "needsApproval")}</span>
        </div>
      </div>
    </div>
  );
}

function ComposerPermissionRequest({ lang, suggestion, risk, onPermissionDecision }) {
  if (!suggestion?.commands?.length) return null;
  const choose = (event, decision) => {
    event.preventDefault();
    event.stopPropagation();
    onPermissionDecision(suggestion, decision);
  };

  return (
    <div className="composer-approval" data-risk={risk}>
      <div className="composer-approval-head">
        <div className="composer-approval-icon">
          <Icon.shield />
        </div>
        <div className="composer-approval-title">
          <span>{t(lang, "permissionRequest")}</span>
          <strong>{t(lang, "terminalCommandReview")}</strong>
        </div>
        <span className={"risk " + risk}>{riskLabel(lang, risk)}</span>
      </div>
      <div className="composer-approval-summary">{suggestion.title}</div>
      <div className="agent-event-section-label">{t(lang, "commandPreview")}</div>
      <div className="composer-approval-cmds">
        {suggestion.commands.map((command, index) => (
          <div className="composer-approval-cmd" key={command.cmd + index}>
            <span className="composer-approval-order">{index + 1}</span>
            <code>{command.cmd}</code>
            <span className={"risk " + command.risk}>{riskLabel(lang, command.risk)}</span>
            <span className="target">{commandTargetLabel(command)}</span>
          </div>
        ))}
      </div>
      {suggestion.note && (
        <div className="composer-approval-reason">
          <span>{t(lang, "reason")}</span>
          <span>{suggestion.note}</span>
        </div>
      )}
      <div className="composer-approval-actions">
        <button
          className="btn btn-ghost"
          type="button"
          onClick={(event) => choose(event, "denied")}
        >
          {t(lang, "permissionDeny")}
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={(event) => choose(event, "always_allow")}
        >
          {t(lang, "alwaysAllow")}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={(event) => choose(event, "allow_once")}
        >
          <Icon.shield /> {t(lang, "allowOnce")}
        </button>
      </div>
    </div>
  );
}

function AgentTurn({
  msg, lang, onChooseDecisionOption,
}) {
  const suggestion = msg.suggestion;
  const decisionEvent = msg.decisionEvent;
  const permissionDecision = msg.permissionDecision;
  const isRunning = msg.progress?.status === "running";
  const isFailed = msg.progress?.status === "failed";
  const risk = suggestion?.commands?.length ? highestSuggestionRisk(suggestion) : null;
  const title = isRunning ? "Working" : isFailed ? "Could not finish" : null;
  const steps = msg.progress?.steps || [];
  const showRuntimeState = Boolean(title);
  const answerMeta = msg.answerMeta;

  return (
    <div className={"agent-turn" + (isRunning ? " running" : "") + (isFailed ? " failed" : "") + (!showRuntimeState ? " completed" : "")}>
      {showRuntimeState && (
        <div className="agent-turn-head">
          <span>{title}</span>
          <span>{msg.at}</span>
        </div>
      )}
      {showRuntimeState && steps.length > 0 && (
        <div className="agent-turn-progress">
          {steps.map((step, index) => (
            <div
              className={"agent-turn-step " + (isRunning && index === steps.length - 1 ? "active" : "done")}
              key={progressStepKey(step, index)}
            >
              <span className="agent-turn-dot" />
              <span className="agent-turn-step-copy">
                <span>{progressStepLabel(lang, step)}</span>
                {progressStepDetail(step) && <span>{progressStepDetail(step)}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {!showRuntimeState && answerMeta && (
        <div className="agent-turn-answer-meta">
          Answered {answerMeta.answeredAt} / {formatElapsedMs(answerMeta.elapsedMs)}
        </div>
      )}
      {msg.content && (
        <div className="agent-turn-copy" dangerouslySetInnerHTML={{ __html: renderInline(msg.content) }} />
      )}
      {decisionEvent?.type === "choice" && (
        <AgentChoiceEvent
          lang={lang}
          event={decisionEvent}
          onChoose={(option) => onChooseDecisionOption?.(msg.id, option)}
        />
      )}
      {suggestion?.commands?.length > 0 && (
        <AgentCommandActivity
          lang={lang}
          suggestion={suggestion}
          risk={risk}
          permissionDecision={permissionDecision}
        />
      )}
    </div>
  );
}

function MessageBubble({
  msg, lang, onChooseDecisionOption,
}) {
  if (msg.role === "user") {
    const attachedContext = (msg.contextAttached || []).filter(Boolean);

    return (
      <div className="msg user">
        <div className="msg-meta">
          <span>{msg.at}</span>
          <span className="role-tag user">{t(lang, "you")}</span>
        </div>
        <div className="msg-bubble">{msg.content}</div>
        {attachedContext.length > 0 && (
          <div className="ctx-attach">
            <span className="clip" />
            <span>{"Attached:"} [{attachedContext[0].replace("t-", "")}]</span>
          </div>
        )}
      </div>
    );
  }

  if (msg.progress) {
    return (
      <div className="msg assistant">
        <div className="msg-meta">
          <span>{msg.at}</span>
          <span className="role-tag assistant">Codex</span>
        </div>
        <AgentTurn
          msg={msg}
          lang={lang}
          onChooseDecisionOption={onChooseDecisionOption}
        />
      </div>
    );
  }

  if (msg.suggestion) {
    const s = msg.suggestion;
    if (!s.commands?.length) {
      return (
        <div className="msg assistant">
          <div className="msg-meta">
            <span>{msg.at}</span>
            <span className="role-tag assistant">Codex</span>
          </div>
          <div className="msg-bubble">
            {s.error || s.note || s.title || "Codex could not produce a safe command."}
          </div>
        </div>
      );
    }

    return (
      <div className="msg assistant">
        <div className="msg-meta">
          <span>{msg.at}</span>
          <span className="role-tag assistant">Codex</span>
        </div>
        <AgentTurn
          msg={{ ...msg, progress: { status: "completed", steps: [] } }}
          lang={lang}
          onChooseDecisionOption={onChooseDecisionOption}
        />
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

function TypingIndicator({ lang, activity = [] }) {
  return (
    <div className="msg assistant">
      <div className="msg-meta">
        <span className="role-tag assistant">{t(lang, "assistant")}</span>
        <span>/{t(lang, "typing")}</span>
      </div>
      <div className="typing">
        <span className="blob" />
        <span className="blob" />
        <span className="blob" />
      </div>
      {activity.length > 0 && (
        <div className="agent-activity">
          {activity.map((key, index) => (
            <div
              className={"agent-activity-row " + (index === activity.length - 1 ? "active" : "done")}
              key={key}
            >
              <span className="agent-activity-dot" />
              <span>{t(lang, key)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const WINDOW_RESIZE_ZONES = [
  ["n", "North"],
  ["e", "East"],
  ["s", "South"],
  ["w", "West"],
  ["ne", "NorthEast"],
  ["nw", "NorthWest"],
  ["se", "SouthEast"],
  ["sw", "SouthWest"],
];

function WindowResizeZones({ windowControls, maximized }) {
  if (!windowControls.available || maximized) return null;

  return (
    <div className="window-resize-zones" aria-hidden="true">
      {WINDOW_RESIZE_ZONES.map(([zone, direction]) => (
        <div
          className={"window-resize-zone " + zone}
          key={zone}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            windowControls.startResizeDragging(direction).catch(() => undefined);
          }}
        />
      ))}
    </div>
  );
}

const COMPOSER_REFERENCE_GROUPS = {
  "@": {
    title: "Files and folders",
    items: [
      { label: "@ src/", detail: "Reference a project file or folder" },
      { label: "@ active file", detail: "Attach the current editor context" },
    ],
  },
  "#": {
    title: "PRs and issues",
    items: [
      { label: "# Pull request", detail: "Reference a GitHub PR by number" },
      { label: "# Issue", detail: "Reference an issue when GitHub is connected" },
    ],
  },
  "/": {
    title: "Slash commands",
    items: [
      { label: "/review", detail: "Ask the provider to review the current project" },
      { label: "/test", detail: "Ask for a focused test command suggestion" },
    ],
  },
};

function composerReferenceGroup(value) {
  const text = String(value || "");
  const token = text.split(/\s/).at(-1) || "";
  const trigger = token[0];
  if (!trigger || !COMPOSER_REFERENCE_GROUPS[trigger]) return null;
  if (token.length > 24) return null;
  return COMPOSER_REFERENCE_GROUPS[trigger];
}

function Composer({
  lang, activeProvider, providerCapabilities, selectedModelId, onSelectModel,
  reasoningLevel, fastMode, onCycleReasoningLevel, onToggleFastMode,
  attachments, onPickAttachment, onRemoveAttachment, onSend,
  busy = false, onStop,
}) {
  const [val, setVal] = React.useState("");
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const ref = React.useRef(null);
  const providerChipLabel = activeProvider
    ? `${activeProvider.label} ${providerSessionLabel(activeProvider)}`
    : "No provider";
  const availableModels = providerCapabilities?.availableModels || [];
  const selectedModel = availableModels.find((model) => model.modelId === selectedModelId)
    || providerCapabilities?.currentModel
    || null;
  const showModelPicker = Boolean(providerCapabilities?.supportsModelSelection && availableModels.length > 0);
  const enabledAttachments = (providerCapabilities?.attachments || []).filter((attachment) => attachment.enabled);
  const attachmentTitle = enabledAttachments.length > 0
    ? `Attach ${enabledAttachments.map((attachment) => attachment.label).join(", ")}`
    : t(lang, "attach");
  const canAttach = enabledAttachments.length > 0;
  const reasoningLevels = providerReasoningLevels(providerCapabilities);
  const normalizedReasoningLevel = normalizeReasoningLevel(providerCapabilities, reasoningLevel);
  const selectedReasoningIndex = reasoningLevels.findIndex((level) => level.level === normalizedReasoningLevel);
  const reasoningLabel = normalizedReasoningLevel
    ? reasoningLevelLabel(providerCapabilities, normalizedReasoningLevel)
    : "";
  const showReasoningControl = reasoningLevels.length > 0 && Boolean(normalizedReasoningLevel);
  const showFastMode = Boolean(providerCapabilities?.supportsFastMode);
  const referenceGroup = composerReferenceGroup(val);
  const submit = () => {
    if (busy) {
      onStop?.();
      return;
    }

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

  return (
    <div className="composer">
      <div className="composer-input">
        <div className="composer-top">
          <textarea
            ref={ref}
            value={val}
            onChange={onInput}
            onKeyDown={onKey}
            placeholder={t(lang, "typeMessage")}
            rows={1}
          />
          <span className="composer-hint">⌘L</span>
        </div>
        {attachments.length > 0 && (
          <div className="composer-attachments" aria-label="Attached context">
            {attachments.map((attachment) => (
              <span className="composer-attachment-chip" key={attachment.path}>
                <span>{attachment.label || labelFromPath(attachment.path)}</span>
                <button
                  type="button"
                  title={`Remove ${attachment.label || labelFromPath(attachment.path)}`}
                  onClick={() => onRemoveAttachment(attachment.path)}
                >
                  <Icon.x />
                </button>
              </span>
            ))}
          </div>
        )}
        {referenceGroup && (
          <div className="composer-reference-menu">
            <div className="composer-reference-title">{referenceGroup.title}</div>
            {referenceGroup.items.map((item) => (
              <button
                className="composer-reference-option"
                key={item.label}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setVal((current) => {
                  const prefix = current.replace(/(\S*)$/, "");
                  return `${prefix}${item.label} `;
                })}
              >
                <span>{item.label}</span>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
        )}
        <div className="composer-foot">
          <button
            className="composer-tool"
            title={attachmentTitle}
            type="button"
            disabled={!canAttach}
            onClick={onPickAttachment}
          >
            <Icon.plus />
          </button>
          {showModelPicker && (
            <div className="composer-model-wrap">
              <button
                className="composer-model-chip"
                type="button"
                aria-expanded={modelMenuOpen}
                onClick={() => setModelMenuOpen((open) => !open)}
              >
                <span>{selectedModel?.label || "Default model"}</span>
                <Icon.chevronDown />
              </button>
              {modelMenuOpen && (
                <div className="composer-model-menu" role="listbox" aria-label="Agent model">
                  {availableModels.map((model) => (
                    <button
                      className={"composer-model-option" + (model.modelId === selectedModelId ? " active" : "")}
                      key={model.modelId}
                      type="button"
                      role="option"
                      aria-selected={model.modelId === selectedModelId}
                      onClick={() => {
                        onSelectModel(model.modelId);
                        setModelMenuOpen(false);
                      }}
                    >
                      <span>{model.label}</span>
                      <code>{model.modelId}</code>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!showModelPicker && (
            <button
              className="composer-provider-chip"
              title={providerSessionLabel(activeProvider)}
              type="button"
            >
              {activeProvider && (
                <span className={"provider-mark " + activeProvider.id}>
                  {activeProvider.abbr}
                </span>
              )}
              <span>{providerChipLabel}</span>
            </button>
          )}
          {showReasoningControl && (
            <button
              className="composer-reasoning-chip"
              title="Reasoning level"
              type="button"
              onClick={onCycleReasoningLevel}
            >
              <span className="reasoning-bars" aria-hidden="true">
                {reasoningLevels.map((level, index) => (
                  <i
                    className={index <= selectedReasoningIndex ? "active" : ""}
                    key={level.level}
                  />
                ))}
              </span>
              <span>{reasoningLabel}</span>
            </button>
          )}
          {showFastMode && (
            <button
              className={"fast-toggle" + (fastMode ? " active" : "")}
              aria-pressed={fastMode}
              title="Fast mode"
              type="button"
              onClick={onToggleFastMode}
            >
              <span className="fast-toggle-dot" />
              <span>Fast mode</span>
            </button>
          )}
          <button
            className={"send" + (busy ? " stopping" : "")}
            onClick={submit}
            disabled={!busy && !val.trim()}
            title={busy ? "Stop response" : "Send"}
          >
            {busy ? <Icon.stop /> : <Icon.send />}
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentPanel({
  lang, messages, isTyping, agentActivity = [],
  onSend, providers, collapseAgent,
  activeProviderId, onOpenSettings, project,
  providerCapabilities, selectedModelId, onSelectModel,
  reasoningLevel, fastMode, onCycleReasoningLevel, onToggleFastMode,
  agentWorkspace, activeAgentSessionId, onSelectAgentSession,
  onNewAgentSession, onCloseAgentSession,
  attachments, onPickAttachment, onRemoveAttachment,
  onChooseDecisionOption, onPermissionDecision, onStopAgentRequest,
}) {
  const chatRef = React.useRef(null);
  const agentBusy = isTyping || messages.some((message) => message.progress?.status === "running");
  const pendingPermissionMessage = [...messages]
    .reverse()
    .find((message) => message.suggestion?.commands?.length > 0 && !message.permissionDecision);
  const pendingPermissionSuggestion = pendingPermissionMessage?.suggestion || null;
  const pendingPermissionRisk = pendingPermissionSuggestion
    ? highestSuggestionRisk(pendingPermissionSuggestion)
    : null;
  React.useLayoutEffect(() => {
    const chat = chatRef.current;
    if (!chat) return undefined;

    let frame = window.requestAnimationFrame(() => {
      chat.scrollTop = chat.scrollHeight;
      frame = window.requestAnimationFrame(() => {
        chat.scrollTop = chat.scrollHeight;
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, isTyping, agentActivity, pendingPermissionMessage?.id]);

  const active = providers.find((p) => p.id === activeProviderId) || providers.find((p) => p.state === "connected") || providers[0];
  const activeAgentSession = agentWorkspace?.sessions?.find((session) => session.id === activeAgentSessionId)
    || agentWorkspace?.sessions?.[0]
    || null;

  return (
    <aside className="agent">
      <AgentHeader
        lang={lang}
        activeProvider={active}
        providerCapabilities={providerCapabilities}
        selectedModelId={selectedModelId}
        agentWorkspace={agentWorkspace}
        activeAgentSession={activeAgentSession}
        onOpenSettings={onOpenSettings}
        collapseAgent={collapseAgent}
      />

      <AgentSessionTabs
        agentWorkspace={agentWorkspace}
        activeSessionId={activeAgentSessionId}
        onSelectSession={onSelectAgentSession}
        onNewSession={onNewAgentSession}
        onCloseSession={onCloseAgentSession}
      />

      <div className="chat" ref={chatRef}>
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            lang={lang}
            onChooseDecisionOption={onChooseDecisionOption}
          />
        ))}
        {isTyping && <TypingIndicator lang={lang} activity={agentActivity} />}
      </div>

      {pendingPermissionSuggestion && (
        <ComposerPermissionRequest
          lang={lang}
          suggestion={pendingPermissionSuggestion}
          risk={pendingPermissionRisk}
          onPermissionDecision={onPermissionDecision}
        />
      )}

      <Composer
        lang={lang}
        activeProvider={active}
        providerCapabilities={providerCapabilities}
        selectedModelId={selectedModelId}
        onSelectModel={onSelectModel}
        reasoningLevel={reasoningLevel}
        fastMode={fastMode}
        onCycleReasoningLevel={onCycleReasoningLevel}
        onToggleFastMode={onToggleFastMode}
        attachments={attachments}
        onPickAttachment={onPickAttachment}
        onRemoveAttachment={onRemoveAttachment}
        onSend={onSend}
        busy={agentBusy}
        onStop={onStopAgentRequest}
      />
    </aside>
  );
}

Object.assign(window, { AgentPanel });


// ----- src/modals.jsx -----
// modals.jsx ??approval + OAuth provider connect

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
                        ? ("Outside trusted dirs")
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
              <span className="meta"> /{activeProject.changedFiles} {t(lang, "changes")}</span>
            </div>
          </div>
          <div className="approval-row">
            <div className="lbl">{t(lang, "command")}</div>
            <div className="approval-cmd-list">
              {suggestion.commands.map((c, i) => {
                const targetLabel = c.target === "new"
                  ? ("new tab")
                  : tabs.find((tb) => tb.id === c.target)?.title || c.target;
                return (
                  <div className="approval-cmd" key={i}>
                    <span><span className="order">{i + 1}.</span>{c.cmd}</span>
                    <span className={"risk " + c.risk}>{t(lang, "risk" + c.risk[0].toUpperCase() + c.risk.slice(1))}</span>
                    <span style={{ color: "var(--text-dim)", fontSize: 10.5 }}>-&gt; [{targetLabel}]</span>
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
              {"Yes - kills a process only, no file changes"}
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
      sub: "Anthropic official OAuth",
      url: "https://claude.ai/oauth/authorize?client_id=gtum&scope=read.files...",
    },
    codex: {
      label: "Codex",
      abbr: "Cx",
      sub: "OpenAI official sign-in",
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
                    {selected === id && <div className="check">OK</div>}
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
                <div style={{ color: "var(--text)" }}>{providerMeta[selected].label} {"official sign-in"}</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t(lang, "waitingCallback")}</div>
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 8, fontFamily: "var(--font-mono)" }}>
              Callback URL: gtum://oauth/callback
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
              >OK</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {providerMeta[selected].label} /{t(lang, "connectSuccess")}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
                  {t(lang, "sessionExpiry")} 30{t(lang, "days")} /{"Saved to OS keychain"}
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
              {"Done"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ApprovalModal, OAuthModal, SettingsModal, ApprovalToast });

// ApprovalToast ??bottom-right notification for auto-approved actions.
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

// SettingsModal ??full settings page with tabs in a left rail.
// Sections: Connections / Appearance / Execution / About.
function SettingsModal({
  lang, providers, onClose, onConnect, onDisconnect,
  accent, accentOptions, onSetAccent,
  parallelLimit, onSetParallelLimit,
  approvalPolicy, onSetApprovalPolicy,
  autoApprovalLog,
  streamResponses, onSetStreamResponses,
}) {
  const [section, setSection] = React.useState("connections");

  const sections = [
    { id: "connections", label: t(lang, "settingsConnections") },
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
                              <span className="dot-sep">/</span>
                              {p.expiresInDays == null
                                ? ("CLI session")
                                : <>{t(lang, "sessionExpiry")} {p.expiresInDays}{t(lang, "days")}</>}
                              <span className="dot-sep">/</span>
                              {p.scope.length} {"scopes"}
                            </>
                          : p.state === "error"
                            ? <span style={{ color: "var(--warn)" }}>{p.lastError || ("Connection needs attention")}</span>
                            : p.state === "pending"
                              ? <span style={{ color: "var(--text-dim)" }}>{"Checking login"}</span>
                              : <span style={{ color: "var(--text-dim)" }}>{"Not connected"}</span>}
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

          {section === "appearance" && (
            <div className="settings-pane">
              <h3 className="settings-h">{t(lang, "settingsAppearance")}</h3>
              <div className="settings-row">
                <div className="settings-row-label">{"Accent color"}</div>
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
                {"Controls how the agent confirms before running commands."}
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
                <div><b style={{ color: "var(--text)" }}>gtum</b> /prototype build</div>
                <div>{"Local desktop workspace: projects + multi-terminal + multi-agent"}</div>
                <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>Tauri /Rust /React /xterm.js</div>
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

// ???? Execution policy editor ??????????????????????????????????????????????????????????????????????????????????????????
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
            {"Pick a preset, or fine-tune per risk level."}
          </div>
        </div>
        <div className="policy-preset-bar">
          {["cautious", "default", "bold", "custom"].map((p) => (
            <button
              key={p}
              className={policy.preset === p ? "active" : ""}
              onClick={() => p !== "custom" && applyPreset(p)}
              disabled={p === "custom"}
              title={p === "custom" ? ("Auto-set when you customize") : ""}
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
          {locked && <span className="lock-tag">?逾?</span>}
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

// ???? Recent auto-approvals ????????????????????????????????????????????????????????????????????????????????????????????????
function AutoApprovalLog({ lang, log }) {
  return (
    <div className="audit-box">
      <div className="audit-h">
        <div className="settings-row-label">{t(lang, "autoApproveLog")}</div>
        <div className="settings-row-hint">{"Last 20"}</div>
      </div>
      {log.length === 0 ? (
        <div className="audit-empty">{t(lang, "noAutoApprovals")}</div>
      ) : (
        <div className="audit-rows">
          {log.map((entry) => (
            <div key={entry.id} className={"audit-row" + (entry.undone ? " undone" : "")}>
              <span className="audit-time">{entry.at}</span>
              <span className="audit-cmds">
                {entry.commands.map((c) => c.cmd).join("  / ")}
              </span>
              {entry.undone && (
                <span className="audit-tag">{"reverted"}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ----- src/app.jsx -----
// app.jsx ??main app shell + state, using VS Code-style workspace store.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#5DF18A",
  "lang": "en"
}/*EDITMODE-END*/;

const ACCENT_OPTIONS = ["#5DF18A", "#9D6BFF", "#FF7849", "#5BAEFF", "#F25DAB"];

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
  // Bridges provisional tabs to their eventual runtime owner so closing a tab
  // before create resolves still disposes the backend session when it arrives.
  const terminalCreateOwnersRef = React.useRef(new Map());
  const projectWorkspaces = useProjectWorkspaces({
    fallbackProject: PROJECT,
    readProjectOverview: readRuntimeProjectOverview,
    workspaceService: workspaceRuntimeService,
  });
  const activeProject = projectWorkspaces.activeProject;
  const [projectBusy, setProjectBusy] = React.useState(false);
  const [projectError, setProjectError] = React.useState(null);
  const [providers, setProviders] = React.useState(PROVIDERS_INIT);
  const [tasks, setTasks] = React.useState(TASKS_INIT(lang));
  const [history, setHistory] = React.useState(COMMAND_HISTORY_INIT);
  const [agentSessionStore, setAgentSessionStore] = React.useState(() =>
    ensureAgentWorkspace({}, PROJECT, lang)
  );
  const agentRequestGenerationRef = React.useRef(0);
  const [isTyping, setIsTyping] = React.useState(false);
  const [agentActivity, setAgentActivity] = React.useState([]);
  const [approval, setApproval] = React.useState(null);
  const [oauth, setOauth] = React.useState(null);
  const executing = null;
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
  const [activeProviderId, setActiveProviderId] = React.useState("codex");
  const [providerCapabilities, setProviderCapabilities] = React.useState({});
  const [selectedProviderModels, setSelectedProviderModels] = React.useState({});
  const [selectedProviderAttachments, setSelectedProviderAttachments] = React.useState({});
  const [parallelLimit, setParallelLimit] = React.useState(3);
  const [approvalPolicy, setApprovalPolicy] = React.useState(APPROVAL_POLICY_INIT);
  const [autoApprovalLog, setAutoApprovalLog] = React.useState([]);
  const [toast, setToast] = React.useState(null);
  const [streamResponses, setStreamResponses] = React.useState(true);
  const activeAgentWorkspaceKey = agentWorkspaceKey(activeProject);
  const activeAgentWorkspace = agentSessionStore[activeAgentWorkspaceKey] || null;
  const activeAgentSession = activeAgentWorkspace?.sessions?.find(
    (session) => session.id === activeAgentWorkspace.activeSessionId,
  ) || activeAgentWorkspace?.sessions?.[0] || null;
  const activeAgentSessionId = activeAgentSession?.id || null;
  const messages = activeAgentSession?.messages || [];
  const activeProviderCapabilities = providerCapabilities[activeProviderId] || null;
  const agentReasoningLevel = normalizeReasoningLevel(
    activeProviderCapabilities,
    activeAgentSession?.reasoningLevel,
  );
  const agentFastMode = Boolean(activeAgentSession?.fastMode && activeProviderCapabilities?.supportsFastMode);

  React.useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  React.useEffect(() => {
    setAgentSessionStore((prev) => ensureAgentWorkspace(prev, activeProject, lang));
  }, [activeProject.name, activeProject.path, activeProject.runtimeBacked, lang]);

  const updateAgentSession = React.useCallback((project, sessionId, updater) => {
    setAgentSessionStore((prev) => {
      const ensured = ensureAgentWorkspace(prev, project, lang);
      const key = agentWorkspaceKey(project);
      const workspaceEntry = ensured[key];
      const targetSessionId = sessionId
        || workspaceEntry.activeSessionId
        || workspaceEntry.sessions[0]?.id;
      if (!targetSessionId) return ensured;

      return {
        ...ensured,
        [key]: {
          ...workspaceEntry,
          activeSessionId: targetSessionId,
          sessions: workspaceEntry.sessions.map((session) =>
            session.id === targetSessionId
              ? {
                ...updater(session),
                updatedAt: nowHm(),
              }
              : session
          ),
        },
      };
    });
  }, [lang]);

  const setMessages = React.useCallback((updater) => {
    const targetProject = activeProject;
    const targetSessionId = activeAgentSessionId;
    updateAgentSession(targetProject, targetSessionId, (session) => ({
      ...session,
      messages: typeof updater === "function" ? updater(session.messages) : updater,
    }));
  }, [activeAgentSessionId, activeProject, updateAgentSession]);

  const selectAgentSession = React.useCallback((sessionId) => {
    setAgentSessionStore((prev) => {
      const ensured = ensureAgentWorkspace(prev, activeProject, lang);
      const key = agentWorkspaceKey(activeProject);
      const workspaceEntry = ensured[key];
      if (!workspaceEntry.sessions.some((session) => session.id === sessionId)) return ensured;

      return {
        ...ensured,
        [key]: {
          ...workspaceEntry,
          activeSessionId: sessionId,
        },
      };
    });
  }, [activeProject, lang]);

  const newAgentSession = React.useCallback(() => {
    setAgentSessionStore((prev) => {
      const ensured = ensureAgentWorkspace(prev, activeProject, lang);
      const key = agentWorkspaceKey(activeProject);
      const workspaceEntry = ensured[key];
      const session = makeAgentSession(activeProject, lang, workspaceEntry.sessions.length + 1);

      return {
        ...ensured,
        [key]: {
          ...workspaceEntry,
          activeSessionId: session.id,
          sessions: [...workspaceEntry.sessions, session],
        },
      };
    });
  }, [activeProject, lang]);

  const closeAgentSession = React.useCallback((sessionId) => {
    setAgentSessionStore((prev) => {
      const ensured = ensureAgentWorkspace(prev, activeProject, lang);
      const key = agentWorkspaceKey(activeProject);
      const workspaceEntry = ensured[key];
      if (workspaceEntry.sessions.length <= 1) return ensured;

      const sessions = workspaceEntry.sessions.filter((session) => session.id !== sessionId);
      const nextActiveSessionId = workspaceEntry.activeSessionId === sessionId
        ? sessions[0]?.id
        : workspaceEntry.activeSessionId;

      return {
        ...ensured,
        [key]: {
          ...workspaceEntry,
          activeSessionId: nextActiveSessionId,
          sessions,
        },
      };
    });
  }, [activeProject, lang]);

  const stopAgentRequest = React.useCallback(() => {
    agentRequestGenerationRef.current += 1;
    const stoppedAtMs = Date.now();
    setIsTyping(false);
    setAgentActivity([]);
    setMessages((prev) => prev.map((message) => {
      if (message.progress?.status !== "running") return message;
      const startedAtMs = message.progress.startedAtMs || stoppedAtMs;

      return {
        ...message,
        at: nowHmAt(stoppedAtMs),
        progress: {
          status: "failed",
          steps: message.progress.steps || [],
        },
        answerMeta: {
          answeredAt: nowHmAt(stoppedAtMs),
          elapsedMs: stoppedAtMs - startedAtMs,
        },
        content: "Stopped by user.",
      };
    }));
  }, [setMessages]);

  const cycleAgentReasoningLevel = React.useCallback(() => {
    updateAgentSession(activeProject, activeAgentSessionId, (session) => ({
      ...session,
      reasoningLevel: nextReasoningLevel(activeProviderCapabilities, session.reasoningLevel),
    }));
  }, [activeAgentSessionId, activeProject, activeProviderCapabilities, updateAgentSession]);

  const toggleAgentFastMode = React.useCallback(() => {
    if (!activeProviderCapabilities?.supportsFastMode) return;

    updateAgentSession(activeProject, activeAgentSessionId, (session) => ({
      ...session,
      fastMode: !session.fastMode,
    }));
  }, [activeAgentSessionId, activeProject, activeProviderCapabilities, updateAgentSession]);

  const closeRuntimeTabs = React.useCallback((tabs) => {
    for (const tab of tabs) {
      const registeredOwner = terminalCreateOwnersRef.current.get(tab?.id);
      if (tab?.id) terminalCreateOwnersRef.current.delete(tab.id);
      const projectPath = tab?.terminalSessionId != null
        ? tab.projectPath
        : registeredOwner?.projectPath;
      const terminalSessionId = tab?.terminalSessionId ?? registeredOwner?.terminalSessionId;
      if (
        typeof projectPath !== "string" ||
        projectPath.trim().length === 0 ||
        terminalSessionId == null
      ) continue;
      const owner = {
        projectPath,
        terminalSessionId,
      };
      terminalRuntimeService.closeSession(owner).catch(() => undefined);
    }
  }, []);

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
    setTasks(TASKS_INIT(lang));
    setAgentActivity([]);
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
        if (codex?.status === "connected") {
          setActiveProviderId("codex");
          return;
        }

        const connectedProvider = connections.find((connection) => connection.status === "connected");
        if (connectedProvider?.provider) setActiveProviderId(connectedProvider.provider);
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
    if (!agentSuggestionRuntimeService.hasRuntime()) return undefined;

    let cancelled = false;
    agentSuggestionRuntimeService.readProviderCapabilities(activeProviderId)
      .then((capabilities) => {
        if (cancelled) return;
        setProviderCapabilities((prev) => ({
          ...prev,
          [capabilities.provider]: capabilities,
        }));
        setSelectedProviderModels((prev) => {
          if (Object.prototype.hasOwnProperty.call(prev, capabilities.provider)) return prev;

          return {
            ...prev,
            [capabilities.provider]: capabilities.currentModel?.modelId || null,
          };
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        markProviderError(activeProviderId, message);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProviderId, markProviderError]);
  React.useEffect(() => {
    if (!terminalRuntimeService.hasRuntime()) return undefined;

    let cancelled = false;
    const pollRuntimeTerminals = async () => {
      const runtimeTabs = allTabs(workspaceRef.current)
        .map(({ tab }) => tab)
        .filter((tab) =>
          tab?.runtimeBacked &&
          typeof tab.projectPath === "string" &&
          tab.projectPath.trim().length > 0 &&
          tab.terminalSessionId != null
        );

      for (const tab of runtimeTabs) {
        const owner = {
          projectPath: tab.projectPath,
          terminalSessionId: tab.terminalSessionId,
        };
        try {
          const logs = await terminalRuntimeService.readLogs(owner, 400);
          if (cancelled) return;
          setWorkspace((current) => updateTab(current, tab.id, (currentTab) => {
            if (
              currentTab.projectPath !== owner.projectPath ||
              currentTab.terminalSessionId !== owner.terminalSessionId
            ) {
              return currentTab;
            }
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
          setWorkspace((current) => updateTab(current, tab.id, (currentTab) => {
            if (
              currentTab.projectPath !== owner.projectPath ||
              currentTab.terminalSessionId !== owner.terminalSessionId
            ) {
              return currentTab;
            }
            return {
              ...currentTab,
              status: "failed",
              lines: [
                ...currentTab.lines,
                { kind: "log", text: `terminal read failed: ${message}`, color: "err" },
              ],
            };
          }));
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

  const pushProjectMessage = React.useCallback((message) => {
    setMessages((prev) => [...prev, {
      id: "project-" + Date.now(),
      role: "assistant",
      roleLabel: "System",
      at: nowHm(),
      content: message,
    }]);
  }, [lang]);

  React.useEffect(() => {
    if (!projectWorkspaces.restoreError) return;
    pushProjectMessage(`Could not restore the workspace: ${projectWorkspaces.restoreError}`);
  }, [projectWorkspaces.restoreError, pushProjectMessage]);

  const handleSelectProject = React.useCallback((path) => {
    void projectWorkspaces.activateProject(path);
  }, [projectWorkspaces.activateProject]);

  const handleOpenProject = async () => {
    setProjectBusy(true);
    setProjectError(null);
    try {
      if (!projectRuntimeService.hasRuntime()) {
        pushProjectMessage("Opening a real project folder is available in the installed desktop app.");
        return;
      }
      const selectedPath = await selectRuntimeProjectFolder(
        activeProject.path,
        projectRuntimeService.hasRuntime(),
      );
      if (!selectedPath) return;
      const nextProject = await projectWorkspaces.openProject(selectedPath);
      if (!nextProject) return;
      setHistory((prev) => [...prev, {
        at: nowHm(),
        tab: "workspace",
        cmd: `open ${nextProject.path}`,
        ok: true,
      }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProjectError(message);
      pushProjectMessage(`Could not open the project: ${message}`);
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
      pushProjectMessage(`Could not open the file: ${message}`);
    }
  };

  const requestRuntimeAgentSuggestions = React.useCallback(async (text, messageId, active) => {
    const originProject = { ...activeProject };
    const originTab = active
      ? { ...active, lines: Array.isArray(active.lines) ? [...active.lines] : active.lines }
      : null;
    const originProviderId = activeProviderId;
    const turnId = messageId + "-agent-turn";
    const requestGeneration = agentRequestGenerationRef.current + 1;
    agentRequestGenerationRef.current = requestGeneration;
    const isCurrentRequest = () => agentRequestGenerationRef.current === requestGeneration;
    const startedAtMs = Date.now();
    const attachments = [...(selectedProviderAttachments[originProviderId] || [])];
    const selectedModelId = selectedProviderModels[originProviderId] || null;
    const reasoningLevel = agentReasoningLevel;
    const fastMode = agentFastMode;
    const reasoningLabel = reasoningLevel
      ? reasoningLevelLabel(activeProviderCapabilities, reasoningLevel)
      : "runtime default";
    const runningSteps = makeCodexProgressSteps({
      project: originProject,
      activeTab: originTab,
      providerId: originProviderId,
      model: selectedModelId,
      attachments,
      reasoningLabel,
      fastMode,
    });
    const completedSteps = [
      ...runningSteps,
      {
        id: "finalizing",
        label: "Preparing answer for the agent panel",
        detail: "Formatting the runtime response",
      },
    ];
    setIsTyping(false);
    setAgentActivity([]);
    setMessages((prev) => [...prev, {
      id: turnId,
      role: "assistant",
      roleLabel: "Codex",
      at: nowHm(),
      progress: {
        status: "running",
        steps: runningSteps.slice(0, 1),
        startedAtMs,
      },
    }]);
    setSelectedProviderAttachments((prev) => ({
      ...prev,
      [originProviderId]: [],
    }));
    const revealRunningSteps = (steps) => {
      if (!isCurrentRequest()) return;
      setMessages((prev) => prev.map((message) => message.id === turnId && message.progress?.status === "running"
        ? {
            ...message,
            progress: {
              status: "running",
              steps,
              startedAtMs,
            },
          }
        : message));
    };

    try {
      await waitForAgentProgressStage();
      if (!isCurrentRequest()) return;
      revealRunningSteps(runningSteps.slice(0, 2));

      const suggestionsResultPromise = Promise.resolve(agentSuggestionRuntimeService.requestSuggestions({
          provider: originProviderId,
          project: originProject,
          activeTab: originTab,
          userTask: text,
          model: selectedModelId,
          attachments,
          reasoningLevel,
          fastMode,
        }))
        .then((suggestions) => ({ suggestions }))
        .catch((error) => ({ error }));

      await waitForAgentProgressStage();
      if (!isCurrentRequest()) return;
      revealRunningSteps(runningSteps);

      const suggestionsResult = await suggestionsResultPromise;
      if (!isCurrentRequest()) return;
      if (suggestionsResult.error) {
        throw suggestionsResult.error;
      }

      const suggestions = suggestionsResult.suggestions;
      const actionableSuggestions = suggestions.filter((suggestion) => suggestion.commands.length > 0);
      const errorSuggestions = suggestions.filter((suggestion) => suggestion.error && suggestion.commands.length === 0);
      const replySuggestions = suggestions.filter((suggestion) => !suggestion.error && suggestion.commands.length === 0);
      const primarySuggestion = actionableSuggestions[0] || null;
      const primaryReply = replySuggestions[0] || null;

      if (errorSuggestions.length > 0 && !primarySuggestion) {
        const errorText = errorSuggestions.map((suggestion) => suggestion.error).filter(Boolean).join("\n");
        const answerMeta = makeAgentAnswerMeta(startedAtMs);
        setMessages((prev) => prev.map((message) => message.id === turnId
          ? {
              ...message,
              at: answerMeta.answeredAt,
              progress: {
                status: "failed",
                steps: completedSteps,
              },
              answerMeta,
              content: `Codex could not produce a safe command: ${errorText}`,
            }
          : message));
        return;
      }

      if (primaryReply && !primarySuggestion) {
        const answerMeta = makeAgentAnswerMeta(startedAtMs);
        const replyText = primaryReply.title || primaryReply.note || "Done.";
        const decisionEvent = parseNumberedChoiceEvent(replyText);
        setMessages((prev) => prev.map((message) => message.id === turnId
          ? {
              ...message,
              at: answerMeta.answeredAt,
              progress: {
                status: "completed",
                steps: [],
              },
              answerMeta,
              content: decisionEvent?.prompt || replyText,
              decisionEvent,
            }
          : message));
        return;
      }

      if (!primarySuggestion) {
        const answerMeta = makeAgentAnswerMeta(startedAtMs);
        setMessages((prev) => prev.map((message) => message.id === turnId
          ? {
              ...message,
              at: answerMeta.answeredAt,
              progress: {
                status: "failed",
                steps: completedSteps,
              },
              answerMeta,
              content: "Codex did not return an executable suggestion.",
            }
          : message));
        return;
      }

      const answerMeta = makeAgentAnswerMeta(startedAtMs);
      setMessages((prev) => prev.map((message) => message.id === turnId
        ? {
            ...message,
            at: answerMeta.answeredAt,
            progress: {
              status: "completed",
              steps: completedSteps,
            },
            answerMeta,
            content: "",
            suggestion: primarySuggestion,
          }
        : message));

      if (actionableSuggestions.length > 1) {
        setMessages((prev) => [
          ...prev,
          ...actionableSuggestions.slice(1).map((suggestion, index) => ({
            id: messageId + "-runtime-extra-" + index,
            role: "assistant",
            roleLabel: "Codex",
            at: answerMeta.answeredAt,
            progress: {
              status: "completed",
              steps: [],
            },
            answerMeta,
            content: "",
            suggestion,
          })),
        ]);
      }
    } catch (error) {
      if (!isCurrentRequest()) return;
      const message = error instanceof Error ? error.message : String(error);
      const answerMeta = makeAgentAnswerMeta(startedAtMs);
      setMessages((prev) => prev.map((entry) => entry.id === turnId
        ? {
            ...entry,
            at: answerMeta.answeredAt,
            progress: {
              status: "failed",
              steps: completedSteps,
            },
            answerMeta,
            content: `Could not request Codex suggestions: ${message}`,
          }
        : entry));
    } finally {
      if (isCurrentRequest()) {
        setIsTyping(false);
        setAgentActivity([]);
      }
    }
  }, [
    activeProject,
    activeProviderId,
    activeProviderCapabilities,
    agentFastMode,
    agentReasoningLevel,
    lang,
    selectedProviderAttachments,
    selectedProviderModels,
  ]);

  const handlePickAgentAttachment = React.useCallback(async () => {
    try {
      const attachments = await pickAgentAttachments(providerCapabilities[activeProviderId] || null);
      if (attachments.length === 0) return;
      setSelectedProviderAttachments((prev) => ({
        ...prev,
        [activeProviderId]: [
          ...(prev[activeProviderId] || []),
          ...attachments,
        ],
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [...prev, {
        id: "attach-error-" + Date.now(),
        role: "assistant",
        roleLabel: "Codex",
        at: nowHm(),
        content: `Could not attach the selected file: ${message}`,
      }]);
    }
  }, [activeProviderId, providerCapabilities]);

  const handleRemoveAgentAttachment = React.useCallback((path) => {
    setSelectedProviderAttachments((prev) => ({
      ...prev,
      [activeProviderId]: (prev[activeProviderId] || []).filter((attachment) => attachment.path !== path),
    }));
  }, [activeProviderId]);

  const appendProviderUnavailableMessage = React.useCallback((providerId, messageId) => {
    const provider = providers.find((p) => p.id === providerId);
    const label = provider?.label || providerId;
    setMessages((prev) => [...prev, {
      id: messageId + "-provider-unavailable",
      role: "assistant",
      roleLabel: label,
      at: nowHm(),
      content: `${label} real-provider integration is deferred. The desktop app will not continue with a mock reply; connect Codex first.`,
    }]);
    setIsTyping(false);
    setAgentActivity([]);
  }, [lang, providers]);

  const appendRuntimeProjectRequiredMessage = React.useCallback((messageId) => {
    setMessages((prev) => [...prev, {
      id: messageId + "-runtime-project-required",
      role: "assistant",
      roleLabel: "Codex",
      at: nowHm(),
      content: "Open a real local folder as a project in the desktop app before running a Codex request.",
    }]);
    setIsTyping(false);
    setAgentActivity([]);
  }, []);

  const appendRuntimeUnavailableMessage = React.useCallback((messageId) => {
    setMessages((prev) => [...prev, {
      id: messageId + "-runtime-unavailable",
      role: "assistant",
      roleLabel: "Codex",
      at: nowHm(),
      content: "Real Codex requests only run in the desktop runtime. Open the desktop app, choose a real local project folder, and connect Codex.",
    }]);
    setIsTyping(false);
    setAgentActivity([]);
  }, []);

  // ???? workspace actions (thin wrappers around the pure store) ????????????????????
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
      const title = "terminal";
      const projectPath = activeProject.path;
      if (!activeProject.runtimeBacked) {
        setWorkspace((w) => openTab(w, gId, {
          id: localId,
          projectPath,
          title,
          cwd: ".",
          status: "failed",
          runtimeBacked: false,
          terminalSessionId: null,
          lines: [{
            kind: "log",
            text: "Open a real project folder before creating a terminal.",
            color: "warn",
          }],
        }));
        return;
      }
      terminalCreateOwnersRef.current.set(localId, {
        projectPath,
        terminalSessionId: null,
      });
      setWorkspace((w) => openTab(w, gId, {
        id: localId,
        projectPath,
        title,
        cwd: ".",
        status: "running",
        runtimeBacked: false,
        terminalSessionId: null,
        lines: [{ kind: "log", text: `${projectPath} (${activeProject.branch}) $`, color: "dim" }],
      }));

      terminalRuntimeService.createTerminalTab({
        projectPath,
        title,
        cwd: ".",
      }).then((runtimeTab) => {
        const registeredOwner = terminalCreateOwnersRef.current.get(localId);
        const runtimeOwner = {
          projectPath: runtimeTab.projectPath,
          terminalSessionId: runtimeTab.terminalSessionId,
        };
        if (
          !registeredOwner ||
          registeredOwner.projectPath !== projectPath ||
          registeredOwner.terminalSessionId != null
        ) {
          terminalCreateOwnersRef.current.delete(localId);
          terminalRuntimeService.closeSession(runtimeOwner).catch(() => undefined);
          return;
        }
        terminalCreateOwnersRef.current.set(localId, runtimeOwner);
        setWorkspace((w) => updateTab(w, localId, (tab) => {
          if (
            tab.projectPath !== projectPath ||
            tab.runtimeBacked ||
            tab.terminalSessionId != null
          ) {
            return tab;
          }
          return {
            ...tab,
            ...runtimeTab,
            id: localId,
            title,
            lines: runtimeTab.lines.length > 0 ? runtimeTab.lines : tab.lines,
          };
        }));
      }).catch((error) => {
        const registeredOwner = terminalCreateOwnersRef.current.get(localId);
        if (
          !registeredOwner ||
          registeredOwner.projectPath !== projectPath ||
          registeredOwner.terminalSessionId != null
        ) return;
        terminalCreateOwnersRef.current.delete(localId);
        const message = error instanceof Error ? error.message : String(error);
        setWorkspace((w) => updateTab(w, localId, (tab) => {
          if (
            tab.projectPath !== projectPath ||
            tab.runtimeBacked ||
            tab.terminalSessionId != null
          ) {
            return tab;
          }
          return {
            ...tab,
            status: "failed",
            lines: [...tab.lines, { kind: "log", text: message, color: "err" }],
          };
        }));
      });
    },
    changeFile: (tabId, content) => {
      setWorkspace((w) => updateTab(w, tabId, (tab) => ({
        ...tab,
        content,
        dirty: true,
      })));
    },
    saveFile: async (fileTab) => {
      const current = findTab(workspaceRef.current, fileTab.id)?.tab || fileTab;
      if (current.type !== "editor") return;
      const projectPath = current.projectPath;
      if (current.truncated) {
        pushProjectMessage("Reload the full file before saving; truncated previews cannot be written.");
        return;
      }

      try {
        const projectOwner = {
          path: projectPath,
          runtimeBacked: true,
        };
        const saved = await saveRuntimeProjectFile(projectOwner, current);
        setWorkspace((w) => updateTab(w, current.id, (tab) => {
          if (tab.projectPath !== projectPath) return tab;
          if (tab.content !== current.content) {
            return {
              ...tab,
              contentHash: saved.contentHash,
              dirty: true,
            };
          }

          return {
            ...tab,
            ...saved,
            id: tab.id,
            dirty: false,
          };
        }));
        setHistory((prev) => [...prev, {
          at: nowHm(),
          tab: "editor",
          cmd: `save ${saved.displayPath || saved.path}`,
          ok: true,
        }]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushProjectMessage(`Could not save the file: ${message}`);
      }
    },
  }), [
    closeRuntimeTabs,
    lang,
    activeProject,
    activeProject.path,
    activeProject.branch,
    activeProject.runtimeBacked,
    pushProjectMessage,
  ]);

  // ???? Send / approve flow uses workspace lookups ????????????????????????????????????????????????
  const activeTab = activeTabOf(workspace);

  const onSend = (text) => {
    const id = "u" + Date.now();
    const attachedTab = activeTab;
    setMessages((prev) => [...prev, {
      id, role: "user", at: nowHm(), content: text,
      contextAttached: attachedTab?.id ? [attachedTab.id] : [],
    }]);
    setIsTyping(true);
    setAgentActivity(["activityPreparing"]);

    if (agentSuggestionRuntimeService.hasRuntime()) {
      if (activeProviderId === "codex") {
        if (!activeProject.runtimeBacked) {
          appendRuntimeProjectRequiredMessage(id);
          return;
        }

        void requestRuntimeAgentSuggestions(text, id, attachedTab);
        return;
      }

      appendProviderUnavailableMessage(activeProviderId, id);
      return;
    }

    appendRuntimeUnavailableMessage(id);
  };

  const handleChooseDecisionOption = React.useCallback((messageId, option) => {
    const sourceMessage = messages.find((message) => message.id === messageId);
    if (sourceMessage?.decisionEvent?.type !== "choice") return;
    if (sourceMessage.decisionEvent.selectedOptionId) return;

    setMessages((prev) => prev.map((message) => {
      if (message.id !== messageId || message.decisionEvent?.type !== "choice") return message;
      return {
        ...message,
        decisionEvent: {
          ...message.decisionEvent,
          selectedOptionId: option.id,
        },
      };
    }));

    onSend(`${option.id}. ${option.label}`);
  }, [messages, onSend]);

  const recordPermissionDecision = React.useCallback(async (sugg, decision) => {
    const at = nowHm();
    const markDecision = (message) => message.suggestion?.id === sugg.id
      ? {
          ...message,
          permissionDecision: {
            status: decision,
            at,
          },
        }
      : message;

    if (decision === "denied") {
      setMessages((prev) => [
        ...prev.map(markDecision),
        {
          id: "permission-decision-" + Date.now(),
          role: "assistant",
          roleLabel: "Codex",
          at,
          content: `${t(lang, "permissionDenied")} Suggested command: \`${sugg.commands[0]?.cmd || ""}\``,
        },
      ]);
      return;
    }

    setApproval(null);
    const jobResults = [];
    for (let index = 0; index < sugg.commands.length; index += 1) {
      const command = sugg.commands[index];
      try {
        const job = await agentJobRuntimeService.createProjectJob(
          activeProject,
          command.cmd,
          `agent-${sugg.id || "command"}-${index + 1}`,
        );
        jobResults.push({ command: command.cmd, job, ok: job.status !== "failed" });
        setHistory((prev) => [...prev, {
          at,
          tab: "agent",
          cmd: command.cmd,
          ok: job.status !== "failed",
        }]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        jobResults.push({ command: command.cmd, error: message, ok: false });
        setHistory((prev) => [...prev, {
          at,
          tab: "agent",
          cmd: command.cmd,
          ok: false,
        }]);
      }
    }

    const jobSummary = jobResults.map((result) => {
      if (result.job?.jobId != null && result.job.jobId >= 0) {
        return `\`${result.command}\` -> agent job #${result.job.jobId}`;
      }
      if (result.error) return `\`${result.command}\` -> ${result.error}`;
      return `\`${result.command}\` -> ${result.job?.lastEvent || "agent job unavailable"}`;
    }).join("\n");

    setMessages((prev) => [
      ...prev.map(markDecision),
      {
        id: "permission-decision-" + Date.now(),
        role: "assistant",
        roleLabel: "Codex",
        at,
        content: `${t(lang, "decisionKept")}\n${jobSummary}`,
      },
    ]);
  }, [activeProject, lang, setMessages]);

  const openOAuth = (providerId) => setOauth({ providerId });
  const handleProviderConnect = async (providerId) => {
    if (providerId === "codex" && agentAuthRuntimeService.hasRuntime()) {
      setActiveProviderId("codex");
      setProviders((prev) => prev.map((provider) => provider.id === "codex"
        ? { ...provider, state: "pending", lastError: null }
        : provider));
      try {
        const connection = await agentAuthRuntimeService.beginLogin("codex", CODEX_REQUIRED_SCOPES);
        applyProviderConnection(connection);
        if (connection.status === "connected") {
          pushProjectMessage(`${connection.displayName} connected through ${connection.connectionKind === "real" ? "the local CLI session" : "the runtime provider"}.`);
          setSettingsOpen(false);
          return;
        }

        const connectionError = connection.lastError || (
          "Complete Codex CLI login, then reconnect."
        );
        markProviderError("codex", connectionError);
        pushProjectMessage(connectionError);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        markProviderError("codex", message);
        pushProjectMessage(`Could not validate Codex session: ${message}`);
      }
      return;
    }

    if (agentAuthRuntimeService.hasRuntime()) {
      const provider = providers.find((p) => p.id === providerId);
      const label = provider?.label || providerId;
      setSettingsOpen(false);
      markProviderError(providerId, `${label} real-provider support is deferred.`);
      pushProjectMessage(`${label} real-provider support is deferred. The desktop app does not connect it through mock OAuth.`);
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
              data-command-history-count={history.length}
              data-project-error={projectError ? "true" : "false"}
              ref={windowRef}
            >
            <WindowResizeZones windowControls={windowControls} maximized={maximized} />
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
                  projectRows={projectWorkspaces.rows}
                  activeProjectPath={projectWorkspaces.registry.activePath}
                  openingProject={projectBusy}
                  collapseSidebar={() => setSidebarOpen(false)}
                  onOpenProject={handleOpenProject}
                  onSelectProject={handleSelectProject}
                  onOpenFile={handleOpenFile}
                  agentWorkspace={activeAgentWorkspace}
                  activeAgentSessionId={activeAgentSessionId}
                  activeProvider={providers.find((p) => p.id === activeProviderId) || providers[0]}
                  onSelectAgentSession={selectAgentSession}
                  onNewAgentSession={newAgentSession}
                  onCloseAgentSession={closeAgentSession}
                />
              )}
              {sidebarOpen && (
                <div
                  className="resize-handle handle-left"
                  onPointerDown={startResize("left")}
                  title={"Drag to resize"}
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
                  title={"Drag to resize"}
                />
              )}
              {agentOpen && (
                <AgentPanel
                  lang={lang}
                  messages={messages}
                  isTyping={isTyping}
                  agentActivity={agentActivity}
                  onSend={onSend}
                  providers={providers}
                  collapseAgent={() => setAgentOpen(false)}
                  activeProviderId={activeProviderId}
                  onOpenSettings={() => setSettingsOpen(true)}
                  project={activeProject}
                  providerCapabilities={activeProviderCapabilities}
                  selectedModelId={selectedProviderModels[activeProviderId] || null}
                  onSelectModel={(modelId) => setSelectedProviderModels((prev) => ({
                    ...prev,
                    [activeProviderId]: modelId,
                  }))}
                  reasoningLevel={agentReasoningLevel}
                  fastMode={agentFastMode}
                  onCycleReasoningLevel={cycleAgentReasoningLevel}
                  onToggleFastMode={toggleAgentFastMode}
                  agentWorkspace={activeAgentWorkspace}
                  activeAgentSessionId={activeAgentSessionId}
                  onSelectAgentSession={selectAgentSession}
                  onNewAgentSession={newAgentSession}
                  onCloseAgentSession={closeAgentSession}
                  attachments={selectedProviderAttachments[activeProviderId] || []}
                  onPickAttachment={handlePickAgentAttachment}
                  onRemoveAttachment={handleRemoveAgentAttachment}
                  onChooseDecisionOption={handleChooseDecisionOption}
                  onPermissionDecision={recordPermissionDecision}
                  onStopAgentRequest={stopAgentRequest}
                />
              )}
            </div>
            <StatusBar
              lang={lang}
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
          onApprove={(suggestion) => {
            void recordPermissionDecision(suggestion, "approved");
          }}
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
          parallelLimit={parallelLimit}
          approvalPolicy={approvalPolicy}
          autoApprovalLog={autoApprovalLog}
          streamResponses={streamResponses}
          onClose={() => setSettingsOpen(false)}
          onConnect={handleProviderConnect}
          onDisconnect={onDisconnect}
          onSetAccent={(v) => setTweak("accent", v)}
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
              roleLabel: "Operator",
              at: nowHm(),
              content: `Marked \`${toast.cmd}\` as reverted in the local audit log.`,
            }]);
            setToast(null);
          }}
        />
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection label={"Appearance"} />
        <TweakColor
          label={"Accent color"}
          value={t_.accent}
          options={ACCENT_OPTIONS}
          onChange={(v) => setTweak("accent", v)}
        />
        <TweakSection label={"Language"} />
        <TweakRadio
          label={"UI language"}
          value={t_.lang}
          options={[{ value: "ko", label: "Korean" }, { value: "en", label: "English" }]}
          onChange={(v) => setTweak("lang", v)}
        />
      </TweaksPanel>
    </>
  );
}

function nowHmAt(timestampMs) {
  const d = new Date(timestampMs);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function nowHm() {
  return nowHmAt(Date.now());
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
