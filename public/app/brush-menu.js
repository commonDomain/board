import { getBrushSettings, setBrushSetting } from './background.js';
import { saveBrushPresets, saveBrushSettings } from './background-model.js';
import { BRUSHES, PALETTE_COLORS } from './constants.js';
import { els } from './elements.js';
import { buildColorPalette, setBrush, setColor } from './format-actions.js';
import { getBrush, setBrushSize } from './format-actions-model.js';
import { makeCustomColorControl } from './format-controls-model.js';
import { openAdaptiveDialog } from './interface.js';
import { refreshIcons } from './interface-model.js';
import { closePopovers } from './popovers.js';
import { state } from './state.js';
import { setTool } from './toolbar.js';
import { clamp } from './utilities.js';
import {
  deleteBrushPreset,
  closeBrushPresetMenu,
  renderBrushPreviewCanvas,
  createBrushPreviewCanvas
} from './brush-menu-model.js';

function buildBrushMenu() {
  if (!els.brushMenu) {
    return;
  }
  els.brushMenu.textContent = '';
  BRUSHES.forEach((brush) => {
    const button = document.createElement('button');
    button.className = 'brush-choice';
    button.type = 'button';
    button.dataset.brush = brush.id;
    button.title = brush.name;

    const name = document.createElement('span');
    name.className = 'brush-name';
    name.textContent = brush.name;

    const brushSettings = getBrushSettings(brush.id);
    const preview = createBrushPreviewCanvas(brush, brushSettings);

    button.append(name, preview);
    button.addEventListener('click', () => {
      setBrush(brush.id);
      setTool('pen');
      const studio = els.brushMenu.querySelector('.brush-studio');
      if (studio) {
        renderBrushStudio(studio);
      }
      closePopovers();
    });
    els.brushMenu.appendChild(button);
  });
  const settings = document.createElement('div');
  settings.className = 'brush-settings';
  const palette = document.createElement('div');
  palette.className = 'color-palette';
  buildColorPalette(palette);
  const colorRow = document.createElement('div');
  colorRow.className = 'color-row';
  colorRow.append(palette);
  const sizePicker = document.createElement('input');
  sizePicker.type = 'range';
  sizePicker.min = '1';
  sizePicker.max = '80';
  sizePicker.value = String(state.size);
  sizePicker.dataset.sizePicker = '';
  sizePicker.title = '粗细';
  const studio = document.createElement('div');
  studio.className = 'brush-studio';
  settings.append(colorRow, sizePicker, studio);
  els.brushMenu.appendChild(settings);
  renderBrushStudio(studio);
  setBrush(state.brushType);
  updateBrushFeedback();
}

function setEraserSize(value) {
  state.eraserSize = clamp(Number(value) || 15, 10, 240);
  try {
    localStorage.setItem('wb:eraserSize', String(state.eraserSize));
  } catch {}
  const slider = els.eraserMenu?.querySelector('input');
  const output = els.eraserMenu?.querySelector('output');
  if (slider) slider.value = String(state.eraserSize);
  if (output) output.textContent = `${state.eraserSize} px`;
  els.eraserButton?.setAttribute('title', `橡皮擦 · ${state.eraserSize} px`);
}

function buildEraserMenu() {
  els.eraserMenu.innerHTML =
    '<div class="eraser-heading"><strong>橡皮擦</strong></div><label class="eraser-size-label" for="eraserSize">直径 <output for="eraserSize"></output></label><input id="eraserSize" type="range" min="10" max="240" step="1" aria-label="橡皮直径">';
  els.eraserMenu.querySelector('input').addEventListener('input', (event) => setEraserSize(event.target.value));
  setEraserSize(state.eraserSize);
}

function updateBrushFeedback() {
  const mode = { off: '关', vertical: '垂直', horizontal: '水平', cross: '十字' }[state.symmetry];
  document.querySelectorAll('.custom-color-button').forEach((control) => {
    control.style.setProperty('--selected-color', state.color);
    control.classList.toggle(
      'active',
      state.customColorSelected || !PALETTE_COLORS.includes(state.color.toLowerCase())
    );
    control.querySelector('.custom-color-value').textContent = state.color.toUpperCase();
    control.title = `自定义颜色 · ${state.color.toUpperCase()}`;
  });
  if (els.brushButton) {
    els.brushButton.style.setProperty('--selected-color', state.color);
    let status = els.brushButton.querySelector('.brush-status');
    if (!status) {
      status = document.createElement('span');
      status.className = 'brush-status';
      els.brushButton.appendChild(status);
    }
    status.textContent = state.symmetry === 'off' ? '' : mode;
    els.brushButton.title = `画笔 · ${state.color.toUpperCase()} · 对称${mode}`;
    els.brushButton.setAttribute('aria-label', els.brushButton.title);
  }
  const symmetry = els.brushMenu?.querySelector('[data-symmetry]');
  if (symmetry) {
    symmetry.value = state.symmetry;
    symmetry.classList.toggle('active', state.symmetry !== 'off');
  }
}

function resetBrushControls() {
  setColor('#111111', { applyToSelection: false });
  setBrushSize(5);
  state.symmetry = 'off';
  updateBrushFeedback();
}

function toggleBrushPresetMenu(trigger, brushId, container) {
  const wasOpen = state.brushPresetPopup?.trigger === trigger;
  closeBrushPresetMenu();
  if (wasOpen) return;
  const panel = document.createElement('div');
  panel.className = 'brush-preset-menu';
  panel.id = 'brushPresetOptions';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '画笔预设列表');
  const presets = state.brushPresets.filter((preset) => preset && preset.brushId === brushId);
  for (const preset of presets) {
    const row = document.createElement('div');
    row.className = 'brush-preset-row';
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'brush-preset-choice';
    choose.textContent = preset.name;
    choose.setAttribute('aria-pressed', String(state.activeBrushPresets[brushId] === preset.name));
    choose.addEventListener('click', () => {
      closeBrushPresetMenu();
      state.activeBrushPresets[brushId] = preset.name;
      state.brushSettings[brushId] = { ...preset.settings };
      saveBrushSettings();
      renderBrushStudio(container);
      refreshActiveBrushPreview();
      container.querySelector('.preset-trigger')?.focus();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'brush-preset-remove';
    remove.setAttribute('aria-label', `删除预设“${preset.name}”`);
    remove.title = '删除此预设';
    remove.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      closeBrushPresetMenu(true);
      const confirmed = await openAdaptiveDialog({
        mode: 'confirm',
        title: '删除画笔预设',
        message: `确定删除“${preset.name}”？当前笔触参数会保留。`,
        confirmLabel: '删除',
        danger: true,
        keepBrushMenuOpen: true
      });
      if (!confirmed) return;
      deleteBrushPreset(brushId, preset.name);
      renderBrushStudio(container);
      container.querySelector('.preset-trigger')?.focus({ preventScroll: true });
    });
    row.append(choose, remove);
    panel.appendChild(row);
  }
  if (!presets.length) {
    const empty = document.createElement('p');
    empty.className = 'brush-preset-empty';
    empty.textContent = '暂无预设，点击“存预设”添加';
    panel.appendChild(empty);
    panel.tabIndex = -1;
  }
  panel.addEventListener('click', (event) => event.stopPropagation());
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeBrushPresetMenu(true);
      return;
    }
    const buttons = [...panel.querySelectorAll('button')];
    const current = buttons.indexOf(document.activeElement);
    const target =
      event.key === 'Home'
        ? buttons[0]
        : event.key === 'End'
          ? buttons.at(-1)
          : event.key === 'ArrowDown'
            ? buttons[(current + 1) % buttons.length]
            : event.key === 'ArrowUp'
              ? buttons[(current - 1 + buttons.length) % buttons.length]
              : null;
    if (target) {
      event.preventDefault();
      event.stopPropagation();
      target.focus();
    }
  });
  const events = new AbortController();
  state.brushPresetPopup = { panel, trigger, events };
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-controls', panel.id);
  document.body.appendChild(panel);
  const position = () => {
    const rect = trigger.getBoundingClientRect();
    panel.style.width = `${Math.min(Math.max(250, rect.width), window.innerWidth - 16)}px`;
    const height = Math.min(panel.scrollHeight + 2, 260);
    panel.style.left = `${clamp(rect.left, 8, Math.max(8, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${clamp(rect.bottom + height + 8 < window.innerHeight ? rect.bottom + 6 : rect.top - height - 6, 8, Math.max(8, window.innerHeight - height - 8))}px`;
  };
  position();
  window.addEventListener('resize', position, { signal: events.signal });
  els.brushMenu.addEventListener('scroll', () => closeBrushPresetMenu(), { signal: events.signal });
  panel.addEventListener(
    'focusout',
    (event) => {
      if (event.relatedTarget && !panel.contains(event.relatedTarget) && event.relatedTarget !== trigger)
        closeBrushPresetMenu();
    },
    { signal: events.signal }
  );
  refreshIcons(panel);
  (panel.querySelector('[aria-pressed="true"]') || panel.querySelector('button') || panel).focus();
}

function makeStudioSlider(labelText, key, min, max, step, format) {
  const row = document.createElement('div');
  row.className = 'studio-row';
  const label = document.createElement('label');
  label.className = 'studio-label';
  label.textContent = labelText;
  const value = document.createElement('span');
  value.className = 'studio-value';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.dataset.studioKey = key;
  slider.setAttribute('aria-label', labelText);
  slider.addEventListener('input', () => {
    setBrushSetting(key, Number(slider.value));
    value.textContent = format ? format(Number(slider.value)) : Number(slider.value).toFixed(2);
    refreshActiveBrushPreview();
  });
  row.append(label, value, slider);
  return { row, slider, value, key, format };
}

function renderBrushStudio(container) {
  closeBrushPresetMenu();
  if (!container) {
    return;
  }
  const brush = getBrush();
  const settings = getBrushSettings(brush.id);
  container.textContent = '';

  const globalRow = document.createElement('div');
  globalRow.className = 'studio-global';
  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.value = state.color;
  colorPicker.dataset.colorPicker = '';
  colorPicker.title = '自定义颜色';
  const symmetry = document.createElement('select');
  symmetry.className = 'studio-select';
  symmetry.dataset.symmetry = '';
  symmetry.setAttribute('aria-label', '画笔对称');
  symmetry.classList.toggle('active', state.symmetry !== 'off');
  [
    ['off', '对称：关'],
    ['vertical', '垂直对称'],
    ['horizontal', '水平对称'],
    ['cross', '十字对称']
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === state.symmetry) {
      option.selected = true;
    }
    symmetry.appendChild(option);
  });
  symmetry.addEventListener('change', () => {
    state.symmetry = symmetry.value;
    updateBrushFeedback();
  });
  const resetControls = document.createElement('button');
  resetControls.type = 'button';
  resetControls.className = 'context-btn brush-reset';
  resetControls.textContent = '重置';
  resetControls.title = '重置颜色、粗细和对称';
  resetControls.addEventListener('click', resetBrushControls);
  globalRow.append(makeCustomColorControl(colorPicker), symmetry, resetControls);
  container.appendChild(globalRow);

  const sliders = [
    makeStudioSlider('平滑', 'smooth', 0, 1, 0.01, (value) => `${Math.round(value * 100)}%`),
    makeStudioSlider('压力', 'pressure', 0, 1, 0.01, (value) => `${Math.round(value * 100)}%`),
    makeStudioSlider(
      '压感曲线',
      'pressureGamma',
      0.2,
      4,
      0.05,
      (value) => `${Number(value).toFixed(2)} · ${value < 1 ? '轻压更浓' : value > 1 ? '重压更浓' : '线性'}`
    ),
    makeStudioSlider('流量', 'flow', 0.01, 1, 0.01, (value) => `${Math.round(value * 100)}%`),
    makeStudioSlider('纹理', 'grain', 0, 1, 0.01, (value) => `${Math.round(value * 100)}%`),
    makeStudioSlider('抖动', 'jitter', 0, 1, 0.01, (value) => `${Math.round(value * 100)}%`),
    makeStudioSlider('密度', 'spacing', 0.25, 2, 0.05, (value) => `${Math.round(value * 100)}%`),
    makeStudioSlider('不透明度', 'opacity', 0.05, 1, 0.01, (value) => `${Math.round(value * 100)}%`)
  ];
  if (brush.id === 'calligraphy') {
    sliders.push(makeStudioSlider('笔尖角度', 'nibAngle', -90, 90, 1, (value) => `${value}°`));
  }
  sliders.forEach(({ row, slider, value, key, format }) => {
    slider.value = String(settings[key]);
    value.textContent = format ? format(settings[key]) : Number(settings[key]).toFixed(2);
    // Kept together below so the everyday controls remain visible on short screens.
  });
  const advanced = document.createElement('details');
  advanced.className = 'brush-advanced';
  advanced.open = state.brushAdvancedOpen;
  const summary = document.createElement('summary');
  summary.textContent = '笔触参数';
  const hint = document.createElement('span');
  hint.textContent = '平滑 · 压力 · 纹理';
  summary.appendChild(hint);
  advanced.append(summary, ...sliders.map(({ row }) => row));
  advanced.addEventListener('toggle', () => {
    state.brushAdvancedOpen = advanced.open;
  });
  container.appendChild(advanced);

  const presetRow = document.createElement('div');
  presetRow.className = 'studio-presets';
  const presetSelect = document.createElement('button');
  presetSelect.type = 'button';
  presetSelect.className = 'studio-select preset-trigger';
  presetSelect.setAttribute('aria-label', '画笔预设');
  presetSelect.setAttribute('aria-haspopup', 'dialog');
  presetSelect.setAttribute('aria-expanded', 'false');
  presetSelect.textContent = state.activeBrushPresets[brush.id] || '预设…';
  presetSelect.addEventListener('click', () => toggleBrushPresetMenu(presetSelect, brush.id, container));
  const savePreset = document.createElement('button');
  savePreset.type = 'button';
  savePreset.className = 'context-btn';
  savePreset.textContent = '存预设';
  savePreset.addEventListener('click', async () => {
    const name = await openAdaptiveDialog({
      mode: 'prompt',
      title: '保存画笔预设',
      message: '保存当前画笔参数，之后可以从预设列表快速恢复。',
      inputLabel: '预设名称',
      initialValue: `${brush.name} 自定义`,
      maxLength: 24,
      confirmLabel: '保存',
      keepBrushMenuOpen: true
    });
    if (!name) {
      return;
    }
    state.brushPresets = state.brushPresets.filter(
      (preset) => !(preset && preset.brushId === brush.id && preset.name === name.trim())
    );
    state.brushPresets.push({
      brushId: brush.id,
      name: name.trim().slice(0, 24),
      settings: { ...getBrushSettings(brush.id) }
    });
    saveBrushPresets();
    state.activeBrushPresets[brush.id] = name.trim().slice(0, 24);
    renderBrushStudio(container);
    container.querySelector('.preset-trigger')?.focus({ preventScroll: true });
  });
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'context-btn';
  reset.textContent = '恢复默认';
  reset.title = '重置笔触参数';
  reset.addEventListener('click', () => {
    state.brushSettings[brush.id] = {};
    delete state.activeBrushPresets[brush.id];
    saveBrushSettings();
    renderBrushStudio(container);
    refreshActiveBrushPreview();
  });
  presetRow.append(presetSelect, savePreset, reset);
  container.appendChild(presetRow);
  updateBrushFeedback();
}

function refreshActiveBrushPreview() {
  const button = document.querySelector('.brush-choice.active');
  if (!button) {
    return;
  }
  const preview = button.querySelector('.brush-preview');
  if (!preview) {
    return;
  }
  const brush = getBrush(button.dataset.brush);
  const settings = getBrushSettings(brush.id);
  renderBrushPreviewCanvas(preview, brush, settings);
}
export {
  buildBrushMenu,
  setEraserSize,
  buildEraserMenu,
  updateBrushFeedback,
  resetBrushControls,
  toggleBrushPresetMenu,
  makeStudioSlider,
  renderBrushStudio,
  refreshActiveBrushPreview
};
