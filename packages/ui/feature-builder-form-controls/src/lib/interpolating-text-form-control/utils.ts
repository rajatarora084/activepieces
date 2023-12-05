import {
  FormControl,
  FormGroupDirective,
  NgControl,
  NgForm,
} from '@angular/forms';
import { ErrorStateMatcher, mixinErrorState } from '@angular/material/core';
import { Subject } from 'rxjs';
import { Step } from '@activepieces/ui/feature-builder-store';
import { InsertMentionOperation } from '@activepieces/ui/common';

export const customCodeMentionDisplayName = 'Custom Code';
export const keysWithinPath = (path: string) => {
  const result: string[] = [];
  let insideBrackets = false;
  let word = '';
  let insideDot = true;
  for (let i = 0; i < path.length; i++) {
    if (path[i] === '.' && !insideDot && !insideBrackets) {
      insideDot = true;
      continue;
    }
    if (path[i] === '.' && insideDot) {
      result.push(word);
      word = '';
    } else if (insideDot && path[i] !== '[') {
      word += path[i];
    } else if (path[i] === '[') {
      if (word) {
        result.push(word);
      }
      word = '';
      insideBrackets = true;
      insideDot = false;
    } else if (path[i] === ']') {
      result.push(word);
      word = '';
      insideBrackets = false;
    } else {
      word += path[i];
    }
  }
  if (insideDot) {
    result.push(word);
  }

  return result.map((w) => {
    if (w.startsWith(`"`) || w.startsWith(`'`)) {
      return w.slice(1, w.length - 1);
    }
    return w;
  });
};

export const QuillMaterialBase = mixinErrorState(
  class {
    /**
     * Emits whenever the component state changes and should cause the parent
     * form field to update. Implemented as part of `MatFormFieldControl`.
     * @docs-private
     */
    readonly stateChanges = new Subject<void>();

    constructor(
      public _defaultErrorStateMatcher: ErrorStateMatcher,
      public _parentForm: NgForm,
      public _parentFormGroup: FormGroupDirective,
      /**
       * Form control bound to the component.
       * Implemented as part of `MatFormFieldControl`.
       * @docs-private
       */
      public ngControl: NgControl
    ) {}
  }
);

export class CustomErrorMatcher implements ErrorStateMatcher {
  isErrorState(control: FormControl): boolean {
    return control.touched && control.invalid;
  }
}

export function fromTextToOps(
  text: string,
  allStepsMetaData: (MentionListItem & { step: Step })[]
): {
  ops: (TextInsertOperation | InsertMentionOperation)[];
} {
  try {
    const regex = /(\{\{.*?\}\})/;
    const matched = text.split(regex).filter((el) => el);
    const ops: (TextInsertOperation | InsertMentionOperation)[] = matched.map(
      (item) => {
        if (
          item.length > 5 &&
          item[0] === '{' &&
          item[1] === '{' &&
          item[item.length - 1] === '}' &&
          item[item.length - 2] === '}'
        ) {
          const itemPathWithoutInterpolationDenotation = item.slice(
            2,
            item.length - 2
          );
          const keys = keysWithinPath(itemPathWithoutInterpolationDenotation);
          const stepName = keys[0];
          const stepMetaData = allStepsMetaData.find(
            (s) => s.step.name === stepName
          );

          //Mention text is the whole path joined with spaces
          const mentionText = [
            replaceStepNameWithDisplayName(stepName, allStepsMetaData),
            ...keys.slice(1),
          ].join(' ');
          // TODO FIX stepMetaData?.step.
          const indexInDfsTraversal = -1;
          const prefix = indexInDfsTraversal
            ? `${indexInDfsTraversal + 1}. `
            : '';
          const insertMention: InsertMentionOperation = {
            insert: {
              apMention: {
                value: prefix + mentionText,
                serverValue: item,
                data: {
                  logoUrl: stepMetaData?.logoUrl,
                },
              },
            },
          };
          return insertMention;
        } else {
          return { insert: item };
        }
      }
    );
    return { ops: ops };
  } catch (err) {
    console.error(text);
    console.error(err);
    throw err;
  }
}

function replaceStepNameWithDisplayName(
  stepName: string,
  allStepsMetaData: (MentionListItem & { step: Step })[]
) {
  const stepDisplayName = allStepsMetaData.find((s) => s.step.name === stepName)
    ?.step.displayName;
  if (stepDisplayName) {
    return stepDisplayName;
  }
  return customCodeMentionDisplayName;
}

export interface TextInsertOperation {
  insert: string;
}

export interface QuillEditorOperationsObject {
  ops: (InsertMentionOperation | TextInsertOperation)[];
}

export function fromOpsToText(operations: QuillEditorOperationsObject) {
  const result = operations.ops
    .map((singleInsertOperation) => {
      if (typeof singleInsertOperation.insert === 'string') {
        return singleInsertOperation.insert;
      } else {
        return singleInsertOperation.insert.apMention.serverValue;
      }
    })
    .join('');
  return result;
}

export interface MentionTreeNode {
  propertyPath: string;
  key: string;
  children?: MentionTreeNode[];
  value?: string | unknown;
}
/**Traverses an object to find its child properties and their paths, stepOutput has to be an object on first invocation */
export function traverseStepOutputAndReturnMentionTree(
  stepOutput: unknown,
  path: string,
  lastKey: string
): MentionTreeNode {
  if (stepOutput && typeof stepOutput === 'object') {
    return {
      propertyPath: path,
      key: lastKey,
      children: Object.keys(stepOutput).map((k) => {
        const escpaedKey = k
          .replaceAll(/\\/g, '\\')
          .replaceAll(/"/g, '\\"')
          .replaceAll(/'/g, "\\'")
          .replaceAll(/\n/g, '\\n')
          .replaceAll(/\r/g, '\\r')
          .replaceAll(/\t/g, '\\t')
          .replaceAll(/’/g, '\\’');
        const newPath = Array.isArray(stepOutput)
          ? `${path}[${k}]`
          : `${path}['${escpaedKey}']`;
        const newKey = Array.isArray(stepOutput) ? `${lastKey} ${k}` : k;
        return traverseStepOutputAndReturnMentionTree(
          (stepOutput as Record<string, unknown>)[k],
          newPath,
          newKey
        );
      }),
      value: Object.keys(stepOutput).length === 0 ? 'Empty List' : undefined,
    };
  } else {
    const value = formatStepOutput(stepOutput);
    return { propertyPath: path, key: lastKey, value: value };
  }
}

export interface MentionListItem {
  label: string;
  value: string;
  logoUrl?: string;
}

function formatStepOutput(stepOutput: unknown) {
  if (stepOutput === null) {
    return 'null';
  }
  if (stepOutput === undefined) {
    return 'undefined';
  }
  if (typeof stepOutput === 'string') {
    return `"${stepOutput}"`;
  }

  return stepOutput;
}

export const FIRST_LEVEL_PADDING_IN_MENTIONS_LIST = 53;
export const CHEVRON_SPACE_IN_MENTIONS_LIST = 25;
export function fixSelection(node: Node) {
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
