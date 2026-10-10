import { TEXT_FONT_FAMILIES } from './constants.js';
import { els } from './elements.js';
import { animateFloatingToolbarControl } from './floating-toolbar-menu-model.js';
import { scheduleFloatingToolbarPosition, setupFloatingSelectPicker } from './floating-toolbar-menu.js';
import {
  onFloatingToolbarDragEnd,
  onFloatingToolbarDragMove,
  onFloatingToolbarDragStart
} from './floating-toolbar-position.js';
import { buildColorPalette } from './format-actions.js';
import { refreshIcons } from './interface-model.js';
import { floatingToolbarPositionRuntime } from './runtime/floating-toolbar-position.js';
import { formatControlsRuntime } from './runtime/format-controls.js';

function selectTextAppearanceTab(tab) {
  if (!['fill', 'border'].includes(tab)) return;
  const section = els.contextPanel?.querySelector('#contextTextAppearanceSection');
  if (!section) return;
  section.querySelectorAll('[data-text-appearance-tab]').forEach((button) => {
    const active = button.dataset.textAppearanceTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  section.querySelectorAll('[data-text-appearance-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.textAppearancePanel !== tab;
  });
}

function buildFloatingFormatBar() {
  if (!els.floatingFormatBar) return;
  els.floatingFormatBar.innerHTML = `
    <div class="floating-format-controls">
      <span class="floating-select-picker floating-format-family-shell" data-floating-select-picker>
        <select class="floating-format-family floating-select-source" data-format="family" aria-label="字体"></select>
      </span>
      <span class="floating-select-picker floating-format-size-shell" data-floating-select-picker>
        <select class="floating-format-size floating-select-source" data-format="size" aria-label="字号">
          <option>12</option><option>14</option><option>16</option><option>18</option><option>20</option><option>24</option><option>32</option><option>48</option><option>64</option><option>96</option>
        </select>
      </span>
      <span class="floating-format-divider" aria-hidden="true"></span>
      <button type="button" data-format="bold" title="加粗" aria-label="加粗"><strong>B</strong></button>
      <button class="floating-emphasis-only" type="button" data-note-format="italic" title="斜体" aria-label="斜体"><em>I</em></button>
      <button class="floating-emphasis-only" type="button" data-note-format="underline" title="下划线" aria-label="下划线"><u>U</u></button>
      <span class="floating-format-divider floating-emphasis-only" aria-hidden="true"></span>
      <button type="button" data-format="align" data-value="left" title="左对齐" aria-label="左对齐"><i data-lucide="align-left"></i></button>
      <button type="button" data-format="align" data-value="center" title="居中" aria-label="居中"><i data-lucide="align-center"></i></button>
      <button type="button" data-format="align" data-value="right" title="右对齐" aria-label="右对齐"><i data-lucide="align-right"></i></button>
      <span class="floating-format-divider floating-list-only" aria-hidden="true"></span>
      <button class="floating-list-only" type="button" data-list-mode="number" title="编号列表" aria-label="编号列表"><span class="floating-symbol floating-list-symbol" aria-hidden="true">1.</span></button>
      <button class="floating-list-only" type="button" data-list-mode="bullet" title="项目符号" aria-label="项目符号"><span class="floating-symbol floating-list-symbol" aria-hidden="true">•</span></button>
      <button class="floating-list-only" type="button" data-list-mode="todo" title="待办列表" aria-label="待办列表"><span class="floating-symbol floating-todo-symbol" aria-hidden="true">✓</span></button>
      <button type="button" class="floating-color-control" data-floating-color aria-expanded="false" title="文字颜色" aria-label="文字颜色"><span aria-hidden="true">A</span></button>
      <button class="floating-note-only" type="button" data-note-shadow role="switch" aria-checked="true" title="便签阴影" aria-label="便签阴影"><span class="floating-symbol floating-shadow-symbol" aria-hidden="true">◐</span></button>
      <button type="button" class="floating-more-button" data-floating-more aria-expanded="false" aria-controls="floatingFormatMore" title="更多" aria-label="更多格式"><span class="floating-more-dots" aria-hidden="true">•••</span></button>
    </div>
    <div class="floating-color-palette" data-floating-color-panel hidden>
      <div class="floating-color-strip" data-floating-color-strip role="group" aria-label="常用文字颜色"></div>
      <button type="button" class="floating-color-custom" data-floating-color-custom><i data-lucide="palette" aria-hidden="true"></i><span>自定义</span></button>
      <input class="floating-custom-color-input" type="color" data-color-picker aria-label="自定义文字颜色">
    </div>
    <div id="floatingFormatMore" class="floating-format-more" data-floating-more-panel hidden>
      <div class="floating-menu-view" data-floating-menu-view="root">
        <div class="floating-more-heading"><strong>更多设置</strong><span>按需展开</span></div>
        <div class="floating-more-list">
          <button class="floating-container-only" type="button" data-floating-menu-target="layer"><i data-lucide="layers-3"></i><span>图层</span><i data-lucide="chevron-right"></i></button>
          <button class="floating-text-only" type="button" data-floating-menu-target="appearance"><i data-lucide="panel-top"></i><span>文本框外观</span><i data-lucide="chevron-right"></i></button>
          <button class="floating-note-only" type="button" data-floating-menu-target="note"><i data-lucide="sticky-note"></i><span>便签外观</span><i data-lucide="chevron-right"></i></button>
          <button type="button" data-format="reset"><i data-lucide="rotate-ccw"></i><span>重置格式</span></button>
        </div>
        <div class="floating-layout-choice floating-layout-inline">
          <span>工具栏位置</span>
          <div>
            <button type="button" class="active" data-text-toolbar-mode="floating" aria-pressed="true"><i data-lucide="panel-top-open"></i><span>浮动工具栏</span></button>
            <button type="button" data-text-toolbar-mode="panel" aria-pressed="false"><i data-lucide="panel-right-open"></i><span>右侧面板</span><i data-lucide="chevron-right"></i></button>
          </div>
        </div>
      </div>
      <div class="floating-menu-view floating-menu-subpanel" data-floating-menu-view="layer" hidden>
        <button type="button" class="floating-menu-back" data-floating-menu-back><i data-lucide="chevron-left"></i><span>返回 · 图层</span></button>
        <div class="floating-more-actions floating-layer-actions">
          <button type="button" data-layer-action="top"><i data-lucide="layers-3"></i><span>置于顶层</span></button>
          <button type="button" data-layer-action="up"><i data-lucide="bring-to-front"></i><span>上移一层</span></button>
          <button type="button" data-layer-action="down"><i data-lucide="send-to-back"></i><span>下移一层</span></button>
          <button type="button" data-layer-action="bottom"><i data-lucide="layers-2"></i><span>置于底层</span></button>
        </div>
      </div>
      <div class="floating-menu-view floating-menu-subpanel" data-floating-menu-view="appearance" hidden>
        <button type="button" class="floating-menu-back" data-floating-menu-back><i data-lucide="chevron-left"></i><span>返回 · 文本框外观</span></button>
        <div class="floating-appearance-tabs" role="tablist" aria-label="文本框外观">
          <button type="button" class="active" role="tab" data-floating-appearance-tab="fill" aria-selected="true"><i data-lucide="paint-bucket"></i><span>底色</span></button>
          <button type="button" role="tab" data-floating-appearance-tab="border" aria-selected="false"><i data-lucide="square"></i><span>边框</span></button>
        </div>
        <div class="floating-appearance-content" data-floating-appearance-content="fill">
          <label><span>底色</span><input type="color" data-text-fill-color aria-label="文本框底色"></label>
          <button type="button" class="floating-reset-row" data-text-appearance-reset="fill"><i data-lucide="rotate-ccw"></i><span>恢复默认底色</span></button>
        </div>
        <div class="floating-appearance-content" data-floating-appearance-content="border" hidden>
          <label><span>颜色</span><input type="color" data-text-border-color aria-label="文本框边框颜色"></label>
          <div class="floating-border-grid" role="group" aria-label="边框样式">
            <button type="button" data-text-border-style="solid">实线</button><button type="button" data-text-border-style="dashed">虚线</button>
            <button type="button" data-text-border-style="dotted">点线</button><button type="button" data-text-border-style="double">双线</button>
            <button type="button" data-text-border-style="wave">波浪</button><button type="button" data-text-border-style="stars">星号</button>
            <button type="button" data-text-border-style="vine">藤蔓</button><button type="button" data-text-border-style="paws">足迹</button>
            <button type="button" data-text-border-style="realistic-ivy">常春藤</button><button type="button" data-text-border-style="realistic-wildflower">压花</button>
            <button type="button" data-text-border-style="realistic-shells">珍珠贝</button><button type="button" data-text-border-style="realistic-woodland">林间动物</button>
          </div>
          <button type="button" class="floating-reset-row" data-text-appearance-reset="border"><i data-lucide="rotate-ccw"></i><span>恢复默认边框</span></button>
        </div>
      </div>
      <div class="floating-menu-view floating-menu-subpanel floating-note-only" data-floating-menu-view="note" hidden>
        <button type="button" class="floating-menu-back" data-floating-menu-back><i data-lucide="chevron-left"></i><span>返回 · 便签外观</span></button>
        <div class="floating-more-section">
          <label><span>便签填充</span><input type="color" data-note-fill aria-label="便签填充颜色"></label>
          <label><span>边框</span><select data-note-border aria-label="便签边框"><option value="none">无</option><option value="solid">实线</option></select></label>
          <label class="floating-opacity-row"><span>不透明度</span><input type="range" min="0" max="100" step="1" value="100" data-note-opacity aria-label="便签不透明度"><output data-note-opacity-value>100%</output></label>
          <button type="button" class="floating-reset-row note-appearance-reset" data-note-appearance-reset title="恢复便签默认外观" aria-label="恢复便签默认外观"><i data-lucide="rotate-ccw" aria-hidden="true"></i><span>重置便签外观</span></button>
          <button type="button" class="floating-reset-row" data-note-lock><i data-lucide="lock"></i><span data-note-lock-label>锁定</span></button>
        </div>
      </div>
    </div>`;
  const family = els.floatingFormatBar.querySelector('[data-format="family"]');
  TEXT_FONT_FAMILIES.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    family.appendChild(option);
  });
  els.floatingFormatBar.querySelectorAll('[data-floating-select-picker] select').forEach(setupFloatingSelectPicker);
  const colorStrip = els.floatingFormatBar.querySelector('[data-floating-color-strip]');
  buildColorPalette(colorStrip);
  const customColor = els.floatingFormatBar.querySelector('[data-floating-color-custom]');
  const customColorInput = els.floatingFormatBar.querySelector('.floating-custom-color-input');
  customColor?.addEventListener('click', () => customColorInput?.click());
  els.floatingFormatBar.addEventListener('pointerdown', onFloatingToolbarDragStart);
  window.addEventListener('pointermove', onFloatingToolbarDragMove);
  window.addEventListener('pointerup', onFloatingToolbarDragEnd);
  window.addEventListener('pointercancel', onFloatingToolbarDragEnd);
  els.floatingFormatBar.addEventListener('lostpointercapture', onFloatingToolbarDragEnd);
  els.floatingFormatBar.addEventListener(
    'click',
    (event) => {
      if (
        formatControlsRuntime.floatingToolbarSuppressedPointerId === null ||
        event.detail === 0 ||
        ('pointerId' in event && event.pointerId !== formatControlsRuntime.floatingToolbarSuppressedPointerId)
      )
        return;
      formatControlsRuntime.floatingToolbarSuppressedPointerId = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );
  els.floatingFormatBar.addEventListener('click', (event) =>
    animateFloatingToolbarControl(event.target.closest('button'))
  );
  els.floatingFormatBar.addEventListener('change', (event) =>
    animateFloatingToolbarControl(event.target.closest('select, input'))
  );
  document.fonts?.addEventListener?.('loadingdone', () => {
    floatingToolbarPositionRuntime.floatingToolbarTextOverlapCache = null;
    scheduleFloatingToolbarPosition();
  });
  refreshIcons(els.floatingFormatBar);
}
export { selectTextAppearanceTab, buildFloatingFormatBar };
