const colors=[['红色','#c82536'],['橙色','#ff9218'],['金黄','#ffc51c'],['黄色','#f5ed16'],['黄绿','#a3e518'],['绿色','#167b22'],['浅绿','#80fa45'],['天蓝','#32b2f5'],['蓝色','#1557b8'],['紫色','#8051cb'],['粉色','#f168b4'],['棕色','#914814'],['黑色','#3f3f3f'],['灰色','#808080'],['浅灰','#c5c5c5'],['白色','#f3f3f3']];
const quick=[colors[12],colors[8],colors[5],colors[0]];

export function penPalette(app,button,el) {
  app.penColor ||= quick[0][1];
  const host=el('div','nt-pen-colors');host.dataset.toolLabel='笔迹颜色';host.setAttribute('aria-label','画笔常用颜色');
  const update=()=>{
    for(const control of host.querySelectorAll('[data-pen-color]'))control.setAttribute('aria-pressed',String(app.penColor===control.dataset.penColor));
    host.style.setProperty('--nt-current-pen',app.penColor);
  };
  for(const [label,color] of quick){
    const control=button(label,'',()=>{app.penColor=color;update();},'nt-pen-swatch');
    control.dataset.penColor=color;control.style.setProperty('--nt-swatch',color);host.append(control);
  }
  host.append(button('更多画笔颜色','palette',event=>{
    app.menu('画笔颜色',colors.map(([label,color])=>({label,checked:app.penColor===color,run:()=>{app.penColor=color;update();}})),event.currentTarget,{className:'nt-pen-palette',width:210,cancel:false,decorate:menu=>{
      for(const [index,control] of [...menu.querySelectorAll('.nt-menu-item')].entries()) {
        control.classList.add('nt-pen-swatch');control.style.setProperty('--nt-swatch',colors[index][1]);control.title=colors[index][0];
      }
    }});
  },'nt-pen-palette-trigger'));
  update();return host;
}
