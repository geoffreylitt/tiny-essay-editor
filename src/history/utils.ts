import { MarkdownDoc, Tag } from "@/tee/schema";
import {
  Doc,
  diff,
  decodeChange,
  ActorId,
  DecodedChange,
  Patch,
  getAllChanges,
} from "@automerge/automerge";

export type ChangeGroup = {
  id: string;
  changes: DecodedChange[];
  actorIds: ActorId[];
  charsAdded: number;
  charsDeleted: number;
  diff: Patch[];
  tags: Tag[];
  time?: number;
};

type GroupingAlgorithm = (
  currentGroup: ChangeGroup,
  newChange: DecodedChange,
  numericParameter: number
) => boolean;

export const GROUPINGS: { [key: string]: GroupingAlgorithm } = {
  ByActorAndNumChanges: (
    currentGroup: ChangeGroup,
    newChange: DecodedChange,
    batchSize: number
  ) => {
    return (
      currentGroup.actorIds[0] === newChange.actor &&
      currentGroup.changes.length < batchSize
    );
  },
  ByActor: (currentGroup: ChangeGroup, newChange: DecodedChange) => {
    return currentGroup.actorIds[0] === newChange.actor;
  },
  ByNumberOfChanges: (
    currentGroup: ChangeGroup,
    newChange: DecodedChange,
    batchSize: number
  ) => {
    return currentGroup.changes.length < batchSize;
  },
  ByCharCount: (
    currentGroup: ChangeGroup,
    newChange: DecodedChange,
    batchSize: number
  ) => {
    return currentGroup.charsAdded + currentGroup.charsDeleted < batchSize;
  },

  // This always combines everything into one group,
  // so we only end up splitting when there's a manual tag
  ByTagsOnly: () => true,

  // "batch size" param here means "max gap allowed, in ms"
  //
  ByEditTime: (currentGroup, newChange, maxGapInSeconds) => {
    if (!newChange.time || !currentGroup.time) {
      return true;
    }

    return newChange.time < currentGroup.time + maxGapInSeconds * 1000;
  },

  // Other groupings to try:
  // - time based sessions
  // - use a manual grouping persisted somewhere?
  // - nonlinear: group by actor, out of this sorted order of changes
};

export const GROUPINGS_THAT_TAKE_BATCH_SIZE: Array<keyof typeof GROUPINGS> = [
  "ByActorAndNumChanges",
  "ByNumberOfChanges",
  "ByCharCount",
];

export const GROUPINGS_THAT_TAKE_GAP_TIME: Array<keyof typeof GROUPINGS> = [
  "ByEditTime",
];

/* returns all the changes from this doc, grouped in a simple way for now. */
export const getGroupedChanges = (
  doc: Doc<MarkdownDoc>,
  {
    algorithm,
    numericParameter,
    tags,
  }: {
    algorithm: keyof typeof GROUPINGS;
    numericParameter: number;
    tags: Tag[];
  } = {
    algorithm: "ByActorAndNumChanges",
    /** Some algorithms have a numeric parameter like batch size that the user can control */
    numericParameter: 100,
    tags: [],
  }
) => {
  const changes = getAllChanges(doc);
  const changeGroups: ChangeGroup[] = [];

  let currentGroup: ChangeGroup | null = null;

  const pushCurrentGroup = () => {
    const diffHeads =
      changeGroups.length > 0 ? [changeGroups[changeGroups.length - 1].id] : [];
    currentGroup.diff = diff(doc, diffHeads, [currentGroup.id]);
    changeGroups.push(currentGroup);
  };

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    let decodedChange = decodeChange(change);

    try {
      const metadata = JSON.parse(decodedChange.message);
      decodedChange = { ...decodedChange, metadata };
    } catch (e) {}

    // Choose whether to add this change to the existing group or start a new group depending on the algorithm.
    if (
      currentGroup &&
      GROUPINGS[algorithm](currentGroup, decodedChange, numericParameter)
    ) {
      currentGroup.changes.push(decodedChange);
      currentGroup.charsAdded += decodedChange.ops.reduce((total, op) => {
        return op.action === "set" && op.insert === true ? total + 1 : total;
      }, 0);
      currentGroup.charsDeleted += decodedChange.ops.reduce((total, op) => {
        return op.action === "del" ? total + 1 : total;
      }, 0);

      currentGroup.id = decodedChange.hash;
      if (decodedChange.time) {
        currentGroup.time = decodedChange.time;
      }
      if (!currentGroup.actorIds.includes(decodedChange.actor)) {
        currentGroup.actorIds.push(decodedChange.actor);
      }

      // If this change is tagged, then we should end the current group.
      // This ensures we have a group boundary corresponding to the tag in the changelog.
      // TODO: The comparison here seems a little iffy; we're comparing heads to a single change hash...
      if (tags.find((tag) => tag.heads[0] === decodedChange.hash)) {
        currentGroup.tags = tags.filter(
          (tag) => tag.heads[0] === decodedChange.hash
        );
        pushCurrentGroup();
        currentGroup = null;
      }
    } else {
      if (currentGroup) {
        pushCurrentGroup();
      }
      currentGroup = {
        // the "ID" is the hash of the latest change in the group.
        // TODO: revisit whether this makes sense as an identifier for the group?
        // It's a bit dangerous to store this separately from the changes since they
        // might get out of sync, but it's super convenient in the view...
        id: decodedChange.hash,
        changes: [decodedChange],
        actorIds: [decodedChange.actor],
        charsAdded: decodedChange.ops.reduce((total, op) => {
          return op.action === "set" && op.insert === true ? total + 1 : total;
        }, 0),
        charsDeleted: decodedChange.ops.reduce((total, op) => {
          return op.action === "del" ? total + 1 : total;
        }, 0),
        diff: [],
        tags: [],
        time: decodedChange.time ?? undefined,
      };
    }
  }

  if (currentGroup) {
    pushCurrentGroup();
  }

  return { changeGroups, changeCount: changes.length };
};
