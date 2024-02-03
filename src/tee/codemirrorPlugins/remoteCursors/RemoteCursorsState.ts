import {EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate} from "@codemirror/view"
import {StateField, StateEffect} from "@codemirror/state"

// Effects to update remote selections and cursors
import type { UserData, SelectionData, UserSelectionData } from "."
import { CursorWidget } from "./CursorWidget";

export const setPeerSelectionData = StateEffect.define<UserSelectionData[]>();
export const setUserData = StateEffect.define<UserData>();

// State field to track remote selections and cursors
export const remoteStateField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPeerSelectionData)) {
        decorations = Decoration.none;
        effect.value.forEach(({user, selection}) => {
          if (!user || !selection) { console.log("missing", user, selection); return }
          // Make a widget for the cursor position.
          const widget = Decoration.widget({
            widget: new CursorWidget(user.name, user.color),
            side: 1,
          }).range(selection.cursor);

          // Now mark for highlight any selected ranges.
          const ranges = selection.selections.filter(({from, to}) => (from !== to)).map(({from, to}) => 
            Decoration.mark({class: "remote-selection", attributes: {style: `background-color: color-mix(in srgb, ${user.color} 20%, transparent)`}}).range(from, to)
          ); // the 40 is for 25% opacity

          // Add all this to the decorations set. (We could optimize this by avoiding recreating unchanged values later.)
          decorations = decorations.update({add: [widget, ...ranges], sort: true});
        });
      }
    }
    return decorations;
  },
  provide: f => EditorView.decorations.from(f)
});

export const collaborativePlugin = (remoteStateField, setLocalSelections: (s: SelectionData) => void) => ViewPlugin.fromClass(class {
  view: EditorView;
  constructor(view: EditorView) {
    this.view = view
    this.emitLocalChanges(view);
  }

  update(update: ViewUpdate) {
    if (update.selectionSet || update.docChanged) {
      this.emitLocalChanges(update.view);
    }
  }

  emitLocalChanges(view: EditorView) {
    const {state} = view;
    const selections = state.selection.ranges.map(r => ({from: r.from, to: r.to}));
    const cursor = state.selection.main.head;
    setLocalSelections({selections, cursor})
  }
}, {
  decorations: plugin => plugin.view.state.field(remoteStateField)
});
