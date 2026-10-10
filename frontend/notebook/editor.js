import { Editor, Extension, generateHTML } from '@tiptap/core';
import { noteTags } from './text-formatting.js';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';

const LinkedTaskItem = TaskItem.extend({
  addAttributes() {
    return { ...this.parent?.(), planningNodeId: { default: null, parseHTML: element => element.dataset.planningNode || null, renderHTML: attributes => attributes.planningNodeId ? { 'data-planning-node': attributes.planningNodeId } : {} },
      taskRef: { default: null, parseHTML: element => element.dataset.taskPlan && element.dataset.taskId ? { planId: element.dataset.taskPlan, taskId: element.dataset.taskId } : null,
        renderHTML: attributes => attributes.taskRef ? { 'data-task-plan': attributes.taskRef.planId, 'data-task-id': attributes.taskRef.taskId } : {} } };
  },
  addNodeView() {
    const parent = this.parent?.();
    return props => {
      if (!props.node.attrs.taskRef || !window.MusePlanning?.enabled) return parent(props);
      const dom = document.createElement('li'); dom.dataset.type = 'taskItem';
      const label = document.createElement('div'), contentDOM = document.createElement('div'); label.contentEditable = 'false'; contentDOM.className = 'planning-task-source-body'; dom.append(label, contentDOM);
      const render = value => { dom.dataset.taskPlan = value.attrs.taskRef.planId; dom.dataset.taskId = value.attrs.taskRef.taskId; dom.dataset.planningNode = value.attrs.planningNodeId || ''; label.replaceChildren(window.MusePlanning.renderLinked(value.attrs.taskRef)); };
      render(props.node);
      return { dom, contentDOM, update(value) { if (value.type !== props.node.type || !value.attrs.taskRef) return false; render(value); return true; }, stopEvent: event => label.contains(event.target), ignoreMutation: mutation => label.contains(mutation.target) };
    };
  }
});

const NotebookTags=Extension.create({name:'notebookTags',addGlobalAttributes(){return [{types:['paragraph','heading'],attributes:{noteTag:{default:null,parseHTML:element=>noteTags.some(tag=>tag[0]===element.dataset.noteTag)?element.dataset.noteTag:null,renderHTML:attrs=>{const tag=noteTags.find(entry=>entry[0]===attrs.noteTag);return tag?{'data-note-tag':tag[0],'data-note-tag-symbol':tag[2],'data-note-tag-label':tag[1],style:`--nt-tag-color:${tag[3]}`}:{ };}}}}];}});
export const extensions = () => [StarterKit.configure({ undoRedo: false, heading:{levels:[1,2,3,4,5,6]}, link: { openOnClick: false, protocols: ['http', 'https', 'mailto'] } }), NotebookTags, Highlight.configure({ multicolor: true }), TextStyle, Color, FontFamily, FontSize,
  TextAlign.configure({ types: ['heading', 'paragraph'] }), Table.configure({ resizable: true }), TableRow, TableHeader, TableCell, TaskList, LinkedTaskItem.configure({ nested: true })];
export function renderText(element, host) {
  try { host.innerHTML = generateHTML(element.doc, extensions()); }
  catch { host.textContent = '此内容无法显示'; }
}
export function editText(element, host, callbacks) {
  host.replaceChildren();
  return new Editor({ element: host, extensions: extensions(), content: element.doc,
    editorProps: { attributes: { 'aria-label': '笔记正文', class: 'nt-rich-text' }, handleKeyDown: (_view, event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.isComposing) { event.preventDefault(); callbacks.undo(event.shiftKey); return true; }
      return false;
    } },
    onUpdate: ({ editor, transaction }) => { if (transaction.docChanged) callbacks.change(editor.getJSON()); },
    onSelectionUpdate: ({ editor }) => callbacks.selection?.(editor),
    onBlur: () => callbacks.blur?.()
  });
}
