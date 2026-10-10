'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { publishBuildOutputs } = require('./build-output');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'vendor');
const outputs = [];

function buildVendor(options) {
  const result = esbuild.buildSync({ ...options, write: false });
  outputs.push(...result.outputFiles);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const shared = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ['es2022'],
  logLevel: 'warning'
};

buildVendor({
  ...shared,
  stdin: {
    contents: `export { getStroke, getStrokePoints, getStrokeOutlinePoints } from 'perfect-freehand';`,
    resolveDir: ROOT,
    sourcefile: 'perfect-freehand-entry.js'
  },
  format: 'iife',
  globalName: 'PerfectFreehand',
  outfile: path.join(OUT_DIR, 'perfect-freehand.min.js')
});

buildVendor({
  ...shared,
  stdin: {
    contents: `
      import { createIcons,
        MousePointer2, Hand, PenTool, Eraser, Blend, Shapes, Type, StickyNote,
        Table2, Workflow, Network, Image, Grid3X3, Layers3, Undo2, Redo2,
        Save, Download, ZoomIn, ChevronDown, MoreHorizontal, Ellipsis, Sparkles,
        Circle, SlidersHorizontal, Eye, EyeOff, Lock, Unlock, Plus, Trash2, Pencil,
        ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, X, Check, Wifi,
        WifiOff, Users, RotateCcw, RotateCw, Play, Pause, PanelRight, Menu,
        Paintbrush, Pipette, Minus, Maximize2, FileImage, Palette,
        ListChecks, GitBranch, Star, Heart, CheckCircle2, XCircle, Flag,
        Lightbulb, Zap, Smile, TriangleAlert, CircleHelp, ArrowRight,
        Bookmark, Pin, Bell, Clock3, CalendarDays, Target, Trophy, Rocket,
        Leaf, Coffee, Music2, Camera, Home, BriefcaseBusiness, CircleDot,
        Search, PanelRightOpen, PanelTop, AlignStartVertical, AlignCenterVertical,
        AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
        BetweenHorizontalStart, BetweenVerticalStart, Group, Ungroup, Grid2X2,
        ChevronsUpDown, ChevronsDownUp, ShieldCheck, Shield, FileText, BookOpen, LayoutGrid, Box, Inbox, ChevronLeft, ChevronRight,
        User, UserRoundCog, LogOut, Fingerprint, UserPlus, KeyRound, BadgeCheck, Copy,
        RefreshCw, Link2, UserRoundPlus, LockKeyhole, QrCode, Smartphone, MonitorSmartphone,
        Mail, AtSign, Send, MailCheck, MailPlus, LoaderCircle, CircleAlert,
        ThumbsUp, ThumbsDown, CircleDashed, ListTodo, Presentation, Bug, Wrench,
        Megaphone, Package, MessageCircle, Video, Phone, UsersRound, Timer,
        Hourglass, MapPin, MapPinned, Map, Route, LocateFixed, Navigation, Gift, Plane,
        FileSpreadsheet, AlignLeft, AlignCenter, AlignRight, WrapText, Merge, Split,
        Rows3, Columns3, Snowflake, SortAsc, SortDesc, CirclePlus, Crosshair,
        TableCellsMerge, TableCellsSplit, TableRowsSplit, TableColumnsSplit,
        Upload, ListFilter, ArrowUpNarrowWide, ArrowDownWideNarrow,
        Bold, Italic, Underline, Strikethrough, Unlink, FileInput,
        PanelTopOpen, Layers2, BringToFront, SendToBack, PaintBucket, Square, ExternalLink, NotebookPen, Files, Folder, PanelsTopLeft, Tag, Highlighter, List, ListOrdered, Link, TextCursor, Lasso, Triangle, Maximize, PanelLeft, Scan, Printer, CloudUpload, CopyPlus, GripHorizontal, Scissors, Clipboard, ClipboardPaste
      } from 'lucide';
      const icons = {
        MousePointer2, Hand, PenTool, Eraser, Blend, Shapes, Type, StickyNote,
        Table2, Workflow, Network, Image, Grid3X3, Grid3x3: Grid3X3, Layers3, Undo2, Redo2,
        Save, Download, ZoomIn, ChevronDown, MoreHorizontal, Ellipsis, Sparkles,
        Circle, SlidersHorizontal, Eye, EyeOff, Lock, Unlock, Plus, Trash2, Pencil,
        ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, X, Check, Wifi,
        WifiOff, Users, RotateCcw, RotateCw, Play, Pause, PanelRight, Menu,
        Paintbrush, Pipette, Minus, Maximize2, FileImage, Palette,
        ListChecks, GitBranch, Star, Heart, CheckCircle2, XCircle, Flag,
        Lightbulb, Zap, Smile, TriangleAlert, CircleHelp, ArrowRight,
        Bookmark, Pin, Bell, Clock3, CalendarDays, Target, Trophy, Rocket,
        Leaf, Coffee, Music2, Camera, Home, BriefcaseBusiness, CircleDot,
        Search, PanelRightOpen, PanelTop, AlignStartVertical, AlignCenterVertical,
        AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
        BetweenHorizontalStart, BetweenVerticalStart, Group, Ungroup, Grid2X2, Grid2x2: Grid2X2,
        ChevronsUpDown, ChevronsDownUp, ShieldCheck, Shield, FileText, BookOpen, LayoutGrid, Box, Inbox, ChevronLeft, ChevronRight,
        User, UserRoundCog, LogOut, Fingerprint, UserPlus, KeyRound, BadgeCheck, Copy,
        RefreshCw, Link2, UserRoundPlus, LockKeyhole, QrCode, Smartphone, MonitorSmartphone,
        Mail, AtSign, Send, MailCheck, MailPlus, LoaderCircle, CircleAlert,
        ThumbsUp, ThumbsDown, CircleDashed, ListTodo, Presentation, Bug, Wrench,
        Megaphone, Package, MessageCircle, Video, Phone, UsersRound, Timer,
        Hourglass, MapPin, MapPinned, Map, Route, LocateFixed, Navigation, Gift, Plane,
        FileSpreadsheet, AlignLeft, AlignCenter, AlignRight, WrapText, Merge, Split,
        Rows3, Columns3, Snowflake, SortAsc, SortDesc, CirclePlus, Crosshair,
        TableCellsMerge, TableCellsSplit, TableRowsSplit, TableColumnsSplit,
        Upload, ListFilter, ArrowUpNarrowWide, ArrowDownWideNarrow,
        Bold, Italic, Underline, Strikethrough, Unlink, FileInput,
        PanelTopOpen, Layers2, BringToFront, SendToBack, PaintBucket, Square, ExternalLink, NotebookPen, Files, Folder, PanelsTopLeft, Tag, Highlighter, List, ListOrdered, Link, TextCursor, Lasso, Triangle, Maximize, PanelLeft, Scan, Printer, CloudUpload, CopyPlus, GripHorizontal, Scissors, Clipboard, ClipboardPaste
      };
      let renderSequence = 0;
      export function renderIcons(root = document) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        if (root === document) {
          createIcons({ icons, attrs: { 'stroke-width': 1.8 } });
          document.querySelectorAll('svg[data-lucide]').forEach((icon) => icon.removeAttribute('data-lucide'));
          return;
        }
        const placeholders = [
          ...(root.matches?.('[data-lucide]') ? [root] : []),
          ...root.querySelectorAll('[data-lucide]')
        ];
        if (!placeholders.length || !document.documentElement.contains(root)) return;
        const nameAttr = 'data-muse-icon-' + (++renderSequence);
        placeholders.forEach((placeholder) => {
          placeholder.setAttribute(nameAttr, placeholder.getAttribute('data-lucide'));
          placeholder.removeAttribute('data-lucide');
        });
        createIcons({ icons, nameAttr, attrs: { 'stroke-width': 1.8 } });
        document.querySelectorAll('[' + nameAttr + ']').forEach((icon) => icon.removeAttribute(nameAttr));
        root.querySelectorAll('svg[data-lucide]').forEach((icon) => icon.removeAttribute('data-lucide'));
      }
    `,
    resolveDir: ROOT,
    sourcefile: 'icons-entry.js'
  },
  format: 'iife',
  globalName: 'MuseIcons',
  outfile: path.join(OUT_DIR, 'icons.min.js')
});

buildVendor({
  ...shared,
  entryPoints: [require.resolve('@simplewebauthn/browser')],
  format: 'iife',
  globalName: 'SimpleWebAuthnBrowser',
  outfile: path.join(OUT_DIR, 'simplewebauthn-browser.min.js')
});

buildVendor({
  ...shared,
  stdin: {
    contents: `export { gsap } from 'gsap';`,
    resolveDir: ROOT,
    sourcefile: 'gsap-entry.js'
  },
  format: 'iife',
  globalName: 'MuseGsap',
  outfile: path.join(OUT_DIR, 'gsap.min.js')
});

// Zip primitives for the spreadsheet's xlsx import/export. Only the sync
// helpers are exposed so the global surface stays tiny.
buildVendor({
  ...shared,
  stdin: {
    contents: `export { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';`,
    resolveDir: ROOT,
    sourcefile: 'fflate-entry.js'
  },
  format: 'iife',
  globalName: 'FFlate',
  outfile: path.join(OUT_DIR, 'fflate.min.js')
});

// Namespace-aware streaming XML parser used only inside the XMind import
// worker. Saxes never resolves external entities, which keeps legacy XMind 8
// parsing isolated from the DOM and avoids XXE/network side effects.
buildVendor({
  ...shared,
  stdin: {
    contents: `export { SaxesParser } from 'saxes';`,
    resolveDir: ROOT,
    sourcefile: 'saxes-entry.js'
  },
  format: 'iife',
  globalName: 'Saxes',
  outfile: path.join(OUT_DIR, 'saxes.min.js')
});

publishBuildOutputs(outputs, { root: ROOT }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

