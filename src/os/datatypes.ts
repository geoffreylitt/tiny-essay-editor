import {
  ChangeGroup,
  DecodedChangeWithMetadata,
} from "@/os/versionControl/groupChanges";
import { Annotation } from "@/os/versionControl/schema";
import { TextPatch } from "@/os/versionControl/utils";
import { next as A, Doc } from "@automerge/automerge";
import { Repo } from "@automerge/automerge-repo";
import { FileExportMethod } from "./fileExports";
import { useEffect, useState } from "react";
import { usePackageModulesInRootFolder } from "@/packages/pkg/usePackages";
import { IconType } from "./lib/icons";

export type CoreDataType<D> = {
  id: string;
  type: "patchwork:dataType";
  name: string;
  icon: IconType;
  init: (doc: D, repo: Repo) => void;
  getTitle: (doc: D, repo: Repo) => Promise<string>;
  setTitle?: (doc: any, title: string) => void;
  markCopy: (doc: D) => void; // TODO: this shouldn't be part of the interface
  actions?: Record<string, (doc: Doc<D>, args: object) => void>;
  fileExportMethods?: FileExportMethod<D>[];
  /* Marking a data types as experimental hides it by default
   * so the user has to enable them in their account first  */
  isExperimental?: boolean;
};

export type VersionedDataType<D, T, V> = {
  // TODO (GL 3/12/24): we'd like to unify these two filter methods
  // and possibly combine them with grouping logic soon.

  // Mark whether a given change should be included in the history.
  // Note: This function has a strange signature that takes in a doc and a change
  // independently in a curried way. This is because we want to do doc-global
  // stuff just once up front for performance, and then reuse when checking each change.
  // (See the implementation for Markdown docs as one example.)
  // If Automerge had more ergonomic APIs for observing what ops did, this wouldn't be needed.
  includeChangeInHistory?: (
    doc: D
  ) => (change: DecodedChangeWithMetadata) => boolean;

  // Mark whether a given patch should be included in the history
  includePatchInChangeGroup?: (patch: A.Patch | TextPatch) => boolean; // todo: can we get rid of TextPatch here?

  /** A datatype can define two ways of summarizing a change group.
   *  - The first is a "fallback summary": computed deterministically based on the group contents,
   *  and intended to be a cheap default summary.
   *  - The second is a prompt for an AI summary. This lets an LLM (expensively) compute a string
   *  that summarizes the contents of the change group.
   *
   *  Both are optional.
   * - If a fallback summary isn't provided, Patchwork will fill in a generic summary.
   * - If the AI prompt isn't provided, AI summarization won't run for this datatype.
   */

  /* Generate a summary of a change group based on its contents */
  fallbackSummaryForChangeGroup?: (changeGroup: ChangeGroup<D>) => string;

  /* Generate a prompt for an LLM to summarize a change group */
  promptForAIChangeGroupSummary?: (args: {
    docBefore: D;
    docAfter: D;
  }) => string;

  /* Turn a list of patches into annotations to display in the UI */
  patchesToAnnotations?: (
    doc: D,
    docBefore: D,
    patches: A.Patch[]
  ) => Annotation<T, V>[];

  /* Group annotations into logical units. This function get's passed all annotations
   * that are not associated with any discussions
   *
   * The sort order is not preserved. For sorting implement the sortAnchorsBy method.
   */
  groupAnnotations?: (annotations: Annotation<T, V>[]) => Annotation<T, V>[][];

  /* Resolves to the value the anchor is pointing to in a document.
   * If the anchor cannot be resolved return undefined.
   * If not defined, annotations in the review sidebar won't include the
   * contents of the annotated data.
   */
  valueOfAnchor?: (doc: D, anchor: T) => V | undefined;

  /* Checks if two anchors overlap. This is used to associate edit annotations with
   * discussions. A discussion grabs any annotations that overlap with the anchors
   * associated with the discussion
   *
   * If this method is not implemented deep equal will be used as a fallback
   */
  doAnchorsOverlap?: (doc: D, anchor1: T, anchor2: T) => boolean;

  /** Defines a value for each anchor that will be use to sort them by in descending order.
   *  This is used for example in the SpatialSidebar to sort the annotation group.
   *
   *  If this method is not implemented the anchors will not be sorted.
   */
  sortAnchorsBy?: (doc: D, anchor: T) => any;
};

export type DataType<D, T, V> = CoreDataType<D> & VersionedDataType<D, T, V>;

const isDataType = (
  value: any
): value is DataType<unknown, unknown, unknown> => {
  return "type" in value && value.type === "patchwork:dataType";
};

export const useDataTypes = () => {
  const [dataTypes, setDataTypes] = useState<
    DataType<unknown, unknown, unknown>[]
  >([]);
  const [dynamicDataTypes, setDynamicDataTypes] = useState<
    DataType<unknown, unknown, unknown>[]
  >([]);
  const modules = usePackageModulesInRootFolder();

  // add exported tools in packages to tools
  useEffect(() => {
    setDynamicDataTypes(
      Object.values(modules).flatMap((module) =>
        Object.values(module).filter(isDataType)
      )
    );
  }, [modules]);

  // load packages asynchronously to break the dependency loop tools -> packages -> tools
  useEffect(() => {
    import("@/packages").then((packages) => {
      setDataTypes(
        Object.values(packages).flatMap((module) =>
          Object.values(module).filter(isDataType)
        )
      );
    });
  }, []);

  return dataTypes.concat(dynamicDataTypes);
};

export const useDataType = <D, T, V>(
  id: string
): DataType<D, T, V> | undefined => {
  const dataTypes = useDataTypes();
  return dataTypes.find((dataType) => dataType.id == id) as
    | DataType<D, T, V>
    | undefined;
};
