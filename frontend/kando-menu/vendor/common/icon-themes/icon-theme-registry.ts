// [Museboard] Stand-in for Kando's icon theme registry. Kando loads several icon fonts
// and the user's icon directories; Museboard renders its existing Lucide icons instead.

type IconRenderer = (theme: string, icon: string) => HTMLElement;

export class IconThemeRegistry {
  private static instance = new IconThemeRegistry();

  private renderer: IconRenderer = (_theme, icon) => {
    const element = document.createElement('i');
    element.textContent = icon;
    return element;
  };

  public static getInstance(): IconThemeRegistry {
    return IconThemeRegistry.instance;
  }

  public setRenderer(renderer: IconRenderer) {
    this.renderer = renderer;
  }

  public createIcon(theme: string, icon: string): HTMLElement {
    const container = document.createElement('div');
    container.classList.add('icon-container');
    container.appendChild(this.renderer(theme, icon));
    return container;
  }
}
