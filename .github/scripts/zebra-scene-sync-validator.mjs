// cloud/zebraSyncValidator.ts
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// src/logicModel.ts
var MAX_PROJECT_VARIABLES = 64;
var MAX_OBJECT_VARIABLES = 32;
var MAX_SCENE_SIGNALS = 32;
var MAX_SIGNAL_FIELDS = 16;
var MAX_PROJECT_EVENTS = 64;
var MAX_OBJECT_EVENTS = 64;
var MAX_EVENT_CONDITIONS = 16;
var MAX_EVENT_ACTIONS = 32;
var MAX_LOGIC_STRING_LENGTH = 500;
var SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
var CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
function logicComponent(object) {
  return object?.components.find((component) => component.type === "logic") ?? null;
}
function validateLogicScene(scene) {
  if (!scene || typeof scene !== "object") throw new Error("Scene logic requires a scene document.");
  if (!Array.isArray(scene.assets)) throw new Error("Scene assets must be a list.");
  if (!Array.isArray(scene.inputActions)) throw new Error("Scene input actions must be a list.");
  if (!Array.isArray(scene.projectVariables)) throw new Error("Scene project variables must be a list.");
  if (!Array.isArray(scene.signals)) throw new Error("Scene signals must be a list.");
  if (!Array.isArray(scene.projectEvents)) throw new Error("Scene project Events must be a list.");
  if (!Array.isArray(scene.objects)) throw new Error("Scene logic objects must be a list.");
  if (scene.projectVariables.length > MAX_PROJECT_VARIABLES) throw new Error(`Scene cannot contain more than ${MAX_PROJECT_VARIABLES} project variables.`);
  if (scene.signals.length > MAX_SCENE_SIGNALS) throw new Error(`Scene cannot contain more than ${MAX_SCENE_SIGNALS} signals.`);
  if (scene.projectEvents.length > MAX_PROJECT_EVENTS) throw new Error(`Scene cannot contain more than ${MAX_PROJECT_EVENTS} project Events.`);
  const objectIds = /* @__PURE__ */ new Set();
  for (const object of scene.objects) {
    if (!object || typeof object !== "object" || !SAFE_ID.test(object.id)) throw new Error("Scene logic contains an invalid object id.");
    if (objectIds.has(object.id)) throw new Error(`Scene logic contains duplicate exact object id ${object.id}.`);
    objectIds.add(object.id);
  }
  const assetIds = /* @__PURE__ */ new Set();
  for (const asset of scene.assets) {
    if (!asset || typeof asset !== "object" || !SAFE_ID.test(asset.id)) throw new Error("Scene logic contains an invalid asset id.");
    if (assetIds.has(asset.id)) throw new Error(`Scene logic contains duplicate exact asset id ${asset.id}.`);
    assetIds.add(asset.id);
  }
  const inputActions = /* @__PURE__ */ new Map();
  for (const action of scene.inputActions) {
    if (!action || typeof action !== "object" || !SAFE_ID.test(action.id)) throw new Error("Scene logic contains an invalid input action id.");
    if (inputActions.has(action.id)) throw new Error(`Scene logic contains duplicate exact input action id ${action.id}.`);
    if (action.valueType !== "vector2" && action.valueType !== "button") {
      throw new Error(`Scene input action ${action.id} has an unsupported value type.`);
    }
    inputActions.set(action.id, action);
  }
  const projectVariables = validateVariableDefinitions(scene.projectVariables, "Project", objectIds, assetIds, MAX_PROJECT_VARIABLES);
  const signals = validateSignals(scene.signals);
  const objectVariables = /* @__PURE__ */ new Map();
  for (const object of scene.objects) {
    const components = object.components.filter((component) => component?.type === "logic");
    if (components.length > 1) throw new Error(`Scene object ${object.id} contains more than one logic component.`);
    const timers = object.components.filter((component) => component?.type === "timer");
    if (timers.length > 1) throw new Error(`Scene object ${object.id} contains more than one timer component.`);
    if (timers.length) validateTimer(timers[0], object.id);
    if (components.length) {
      const component = components[0];
      validateExactKeys(component, ["id", "type", "enabled", "variables", "events"], `${object.id} Logic`);
      validateId(component.id, `${object.id} Logic component`);
      if (component.type !== "logic") throw new Error(`Scene object ${object.id} has an invalid Logic component type.`);
      if (typeof component.enabled !== "boolean") throw new Error(`Scene object ${object.id} Logic enabled state must be a boolean.`);
      if (!Array.isArray(component.variables)) throw new Error(`Scene object ${object.id} Logic variables must be a list.`);
      if (!Array.isArray(component.events)) throw new Error(`Scene object ${object.id} Logic events must be a list.`);
      if (component.variables.length > MAX_OBJECT_VARIABLES) throw new Error(`Scene object ${object.id} cannot contain more than ${MAX_OBJECT_VARIABLES} variables.`);
      if (component.events.length > MAX_OBJECT_EVENTS) throw new Error(`Scene object ${object.id} cannot contain more than ${MAX_OBJECT_EVENTS} Events.`);
      objectVariables.set(object.id, validateVariableDefinitions(component.variables, `Object ${object.id}`, objectIds, assetIds, MAX_OBJECT_VARIABLES));
    }
  }
  const resolveVariable = (reference, label) => {
    if (!reference || typeof reference !== "object") throw new Error(`${label} requires a variable reference.`);
    if (reference.scope === "project") {
      validateExactKeys(reference, ["scope", "variableId"], label);
      validateId(reference.variableId, label);
      const variable = projectVariables.get(reference.variableId);
      if (!variable) throw new Error(`${label} references missing project variable ${reference.variableId}.`);
      return variable;
    }
    if (reference.scope === "object") {
      validateExactKeys(reference, ["scope", "objectId", "variableId"], label);
      validateId(reference.objectId, label);
      validateId(reference.variableId, label);
      const variable = objectVariables.get(reference.objectId)?.get(reference.variableId);
      if (!variable) throw new Error(`${label} references missing object variable ${reference.objectId}.${reference.variableId}.`);
      return variable;
    }
    throw new Error(`${label} has an unsupported variable scope.`);
  };
  const validateEvents = (events, ownerLabel, ownerHasTimer, allowTimerTrigger) => {
    const eventIds = /* @__PURE__ */ new Set();
    for (const event of events) {
      if (!event || typeof event !== "object") throw new Error(`${ownerLabel} contains an invalid Event.`);
      validateExactKeys(event, ["id", "name", "enabled", "when", "if", "do"], `${ownerLabel} Event`);
      validateId(event.id, `${ownerLabel} Event`);
      validateUniqueId(event.id, eventIds, `${ownerLabel} Event`);
      validateName(event.name, `${ownerLabel} Event ${event.id}`);
      if (typeof event.enabled !== "boolean") throw new Error(`${ownerLabel} Event ${event.id} enabled state must be a boolean.`);
      const eventLabel = `${ownerLabel} Event ${event.id}`;
      const triggerSignal = validateTrigger(event.when, signals, inputActions, ownerHasTimer, allowTimerTrigger, eventLabel);
      if (!Array.isArray(event.if) || event.if.length > MAX_EVENT_CONDITIONS) throw new Error(`${eventLabel} has an invalid If list.`);
      if (!Array.isArray(event.do) || event.do.length === 0 || event.do.length > MAX_EVENT_ACTIONS) throw new Error(`${eventLabel} must contain between 1 and ${MAX_EVENT_ACTIONS} Do actions.`);
      const nodeIds = /* @__PURE__ */ new Set();
      const sourceType = (source, label) => validateSource(source, label, triggerSignal, objectIds, assetIds, resolveVariable);
      for (const condition of event.if) {
        if (!condition || typeof condition !== "object") throw new Error(`${eventLabel} contains an invalid condition.`);
        validateExactKeys(condition, ["id", "type", "left", "right"], `${eventLabel} condition`);
        validateId(condition.id, `${eventLabel} condition`);
        validateUniqueId(condition.id, nodeIds, `${eventLabel} node`);
        if (!["equals", "not-equals", "at-least", "at-most"].includes(condition.type)) {
          throw new Error(`${eventLabel} contains unsupported condition ${String(condition.type)}.`);
        }
        const leftType = sourceType(condition.left, `${eventLabel} condition ${condition.id} left`);
        const rightType = sourceType(condition.right, `${eventLabel} condition ${condition.id} right`);
        if (leftType !== rightType) throw new Error(`${eventLabel} condition ${condition.id} compares different value types.`);
        if ((condition.type === "at-least" || condition.type === "at-most") && leftType !== "number") {
          throw new Error(`${eventLabel} condition ${condition.id} requires Number values.`);
        }
      }
      for (const action of event.do) {
        if (!action || typeof action !== "object") throw new Error(`${eventLabel} contains an invalid action.`);
        validateId(action.id, `${eventLabel} action`);
        validateUniqueId(action.id, nodeIds, `${eventLabel} node`);
        if (action.type === "set-variable") {
          validateExactKeys(action, ["id", "type", "variable", "value"], `${eventLabel} set action`);
          const target = resolveVariable(action.variable, `${eventLabel} action ${action.id}`);
          const valueType = sourceType(action.value, `${eventLabel} action ${action.id} value`);
          if (target.initialValue.type !== valueType) throw new Error(`${eventLabel} action ${action.id} sets a different value type.`);
          continue;
        }
        if (action.type === "emit-signal") {
          validateExactKeys(action, ["id", "type", "signalId", "payload"], `${eventLabel} emit action`);
          validateId(action.signalId, `${eventLabel} emit action`);
          const signal = signals.get(action.signalId);
          if (!signal) throw new Error(`${eventLabel} action ${action.id} references missing signal ${action.signalId}.`);
          if (!Array.isArray(action.payload) || action.payload.length !== signal.fields.length) throw new Error(`${eventLabel} action ${action.id} payload does not match signal ${signal.id}.`);
          for (let index = 0; index < signal.fields.length; index += 1) {
            const field = signal.fields[index];
            const binding = action.payload[index];
            if (!binding || typeof binding !== "object") throw new Error(`${eventLabel} action ${action.id} has an invalid payload binding.`);
            validateExactKeys(binding, ["fieldId", "value"], `${eventLabel} payload`);
            if (binding.fieldId !== field.id) throw new Error(`${eventLabel} action ${action.id} payload must follow signal field order.`);
            if (sourceType(binding.value, `${eventLabel} action ${action.id} field ${field.id}`) !== field.valueType) {
              throw new Error(`${eventLabel} action ${action.id} field ${field.id} has a different value type.`);
            }
          }
          continue;
        }
        if (action.type === "change-number") {
          validateExactKeys(action, ["id", "type", "variable", "amount"], `${eventLabel} change action`);
          const target = resolveVariable(action.variable, `${eventLabel} action ${action.id}`);
          const amountType = sourceType(action.amount, `${eventLabel} action ${action.id} amount`);
          if (target.initialValue.type !== "number" || amountType !== "number") {
            throw new Error(`${eventLabel} action ${action.id} can change only a Number variable by a Number amount.`);
          }
          continue;
        }
        throw new Error(`${eventLabel} contains unsupported action type ${String(action.type)}.`);
      }
    }
  };
  validateEvents(scene.projectEvents, "Project", false, false);
  for (const object of scene.objects) {
    const component = logicComponent(object);
    if (!component) continue;
    validateEvents(component.events, object.id, Boolean(timerComponent(object)), true);
  }
}
function validateVariableDefinitions(definitions, label, objectIds, assetIds, limit) {
  if (definitions.length > limit) throw new Error(`${label} cannot contain more than ${limit} variables.`);
  const exact = /* @__PURE__ */ new Map();
  const ids = /* @__PURE__ */ new Set();
  for (const variable of definitions) {
    if (!variable || typeof variable !== "object") throw new Error(`${label} contains an invalid variable.`);
    validateExactKeys(variable, ["id", "name", "initialValue"], `${label} variable`);
    validateId(variable.id, `${label} variable`);
    validateUniqueId(variable.id, ids, `${label} variable`);
    validateName(variable.name, `${label} variable ${variable.id}`);
    validateSceneValue(variable.initialValue, `${label} variable ${variable.id}`, objectIds, assetIds);
    exact.set(variable.id, variable);
  }
  return exact;
}
function validateSignals(definitions) {
  const exact = /* @__PURE__ */ new Map();
  const ids = /* @__PURE__ */ new Set();
  for (const signal of definitions) {
    if (!signal || typeof signal !== "object") throw new Error("Scene contains an invalid signal.");
    validateExactKeys(signal, ["id", "name", "fields"], "Signal");
    validateId(signal.id, "Signal");
    validateUniqueId(signal.id, ids, "Signal");
    validateName(signal.name, `Signal ${signal.id}`);
    if (!Array.isArray(signal.fields) || signal.fields.length > MAX_SIGNAL_FIELDS) throw new Error(`Signal ${signal.id} has an invalid field list.`);
    const fieldIds = /* @__PURE__ */ new Set();
    for (const field of signal.fields) {
      if (!field || typeof field !== "object") throw new Error(`Signal ${signal.id} contains an invalid field.`);
      validateExactKeys(field, ["id", "name", "valueType"], `Signal ${signal.id} field`);
      validateId(field.id, `Signal ${signal.id} field`);
      validateUniqueId(field.id, fieldIds, `Signal ${signal.id} field`);
      validateName(field.name, `Signal ${signal.id} field ${field.id}`);
      if (!isValueType(field.valueType)) throw new Error(`Signal ${signal.id} field ${field.id} has an unsupported value type.`);
    }
    exact.set(signal.id, signal);
  }
  return exact;
}
function validateTrigger(trigger, signals, inputActions, ownerHasTimer, allowTimerTrigger, label) {
  if (!trigger || typeof trigger !== "object") throw new Error(`${label} requires a When trigger.`);
  if (trigger.type === "play-started") {
    validateExactKeys(trigger, ["type"], `${label} trigger`);
    return null;
  }
  if (trigger.type === "signal-received") {
    validateExactKeys(trigger, ["type", "signalId"], `${label} trigger`);
    validateId(trigger.signalId, `${label} trigger`);
    const signal = signals.get(trigger.signalId);
    if (!signal) throw new Error(`${label} references missing signal ${trigger.signalId}.`);
    return signal;
  }
  if (trigger.type === "input-action-pressed") {
    validateExactKeys(trigger, ["type", "actionId"], `${label} trigger`);
    validateId(trigger.actionId, `${label} trigger`);
    const action = inputActions.get(trigger.actionId);
    if (!action) throw new Error(`${label} references missing input action ${trigger.actionId}.`);
    if (action.valueType !== "button") throw new Error(`${label} requires a Button input action, but ${trigger.actionId} is ${action.valueType}.`);
    return null;
  }
  if (trigger.type === "timer-finished") {
    validateExactKeys(trigger, ["type"], `${label} trigger`);
    if (!allowTimerTrigger) throw new Error(`${label} cannot use Timer finished because project Events have no owning object.`);
    if (!ownerHasTimer) throw new Error(`${label} requires a Timer component on its owning object.`);
    return null;
  }
  throw new Error(`${label} has an unsupported When trigger.`);
}
function validateTimer(timer, objectId) {
  if (!timer || typeof timer !== "object") throw new Error(`Scene object ${objectId} contains an invalid Timer component.`);
  validateExactKeys(timer, ["id", "type", "enabled", "durationTicks", "repeat"], `${objectId} Timer`);
  validateId(timer.id, `${objectId} Timer component`);
  if (timer.type !== "timer") throw new Error(`Scene object ${objectId} has an invalid Timer component type.`);
  if (typeof timer.enabled !== "boolean") throw new Error(`Scene object ${objectId} Timer enabled state must be a boolean.`);
  if (!Number.isInteger(timer.durationTicks) || timer.durationTicks < 1 || timer.durationTicks > 216e3) {
    throw new Error(`Scene object ${objectId} Timer durationTicks must be an integer between 1 and 216000.`);
  }
  if (typeof timer.repeat !== "boolean") throw new Error(`Scene object ${objectId} Timer repeat state must be a boolean.`);
}
function validateSource(source, label, triggerSignal, objectIds, assetIds, resolveVariable) {
  if (!source || typeof source !== "object") throw new Error(`${label} requires a value source.`);
  if (source.kind === "literal") {
    validateExactKeys(source, ["kind", "value"], label);
    return validateSceneValue(source.value, label, objectIds, assetIds);
  }
  if (source.kind === "variable") {
    validateExactKeys(source, ["kind", "reference"], label);
    return resolveVariable(source.reference, label).initialValue.type;
  }
  if (source.kind === "signal-field") {
    validateExactKeys(source, ["kind", "fieldId"], label);
    validateId(source.fieldId, label);
    if (!triggerSignal) throw new Error(`${label} can use a signal field only inside a matching signal Event.`);
    const field = triggerSignal.fields.find((candidate) => candidate.id === source.fieldId);
    if (!field) throw new Error(`${label} references missing signal field ${source.fieldId}.`);
    return field.valueType;
  }
  throw new Error(`${label} has an unsupported value source.`);
}
function validateSceneValue(value, label, objectIds, assetIds = /* @__PURE__ */ new Set()) {
  if (!value || typeof value !== "object") throw new Error(`${label} requires a tagged value.`);
  if (value.type === "number") {
    validateExactKeys(value, ["type", "number"], label);
    if (!Number.isFinite(value.number) || Math.abs(value.number) > 1e9) throw new Error(`${label} must contain a finite number between -1000000000 and 1000000000.`);
    return value.type;
  }
  if (value.type === "boolean") {
    validateExactKeys(value, ["type", "boolean"], label);
    if (typeof value.boolean !== "boolean") throw new Error(`${label} must contain a boolean.`);
    return value.type;
  }
  if (value.type === "string") {
    validateExactKeys(value, ["type", "text"], label);
    if (typeof value.text !== "string" || value.text.length > MAX_LOGIC_STRING_LENGTH || CONTROL_CHARACTERS.test(value.text)) throw new Error(`${label} contains invalid text.`);
    return value.type;
  }
  if (value.type === "object-ref") {
    validateExactKeys(value, ["type", "objectId"], label);
    validateId(value.objectId, label);
    if (!objectIds.has(value.objectId)) throw new Error(`${label} references missing object ${value.objectId}.`);
    return value.type;
  }
  if (value.type === "asset-ref") {
    validateExactKeys(value, ["type", "assetId"], label);
    validateId(value.assetId, label);
    if (!assetIds.has(value.assetId)) throw new Error(`${label} references missing asset ${value.assetId}.`);
    return value.type;
  }
  throw new Error(`${label} has an unsupported value type.`);
}
function timerComponent(object) {
  return object?.components.find((component) => component.type === "timer") ?? null;
}
function validateId(id, label) {
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new Error(`${label} has an invalid id.`);
}
function validateName(name, label) {
  if (typeof name !== "string" || !name.trim() || name.length > 80 || CONTROL_CHARACTERS.test(name)) throw new Error(`${label} has an invalid name.`);
}
function validateUniqueId(id, ids, label) {
  const key = id.toLowerCase();
  if (ids.has(key)) throw new Error(`Duplicate ${label} id: ${id}.`);
  ids.add(key);
}
function validateExactKeys(value, allowed, label) {
  const allowedKeys = new Set(allowed);
  const extra = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (extra) throw new Error(`${label} contains unsupported field ${extra}.`);
}
function isValueType(value) {
  return value === "number" || value === "boolean" || value === "string" || value === "object-ref" || value === "asset-ref";
}

// src/threeLogicRuntimeSource.ts
var THREE_LOGIC_RUNTIME_SOURCE = String.raw`export const MAX_LOGIC_SIGNAL_DISPATCHES = 128;
export const MAX_LOGIC_TRACE_ENTRIES = 512;
export const MAX_LOGIC_CASCADE_EXECUTIONS = 2048;

export function createLogicRuntime(scene) {
  const projectVariables = new Map();
  const objectVariables = new Map();
  const projectVariableOrder = [];
  const objectVariableOrder = [];
  const timerOrder = [];
  for (const definition of scene.projectVariables) {
    const variable = { scope: "project", objectId: null, definition, value: cloneValue(definition.initialValue) };
    projectVariables.set(definition.id, variable);
    projectVariableOrder.push(variable);
  }
  for (const object of scene.objects) {
    const timer = timerComponent(object);
    if (timer) {
      timerOrder.push({
        ownerObjectId: object.id,
        definition: timer,
        elapsedTicks: 0,
        running: false,
        finishCount: 0,
      });
    }
    const component = logicComponent(object);
    if (!component) continue;
    for (const definition of component.variables) {
      const variable = { scope: "object", objectId: object.id, definition, value: cloneValue(definition.initialValue) };
      objectVariables.set(objectVariableKey(object.id, definition.id), variable);
      objectVariableOrder.push(variable);
    }
  }
  return {
    scene,
    projectVariables,
    objectVariables,
    projectVariableOrder,
    objectVariableOrder,
    signals: new Map(scene.signals.map((signal) => [signal.id, signal])),
    objects: new Map(scene.objects.map((object) => [object.id, object])),
    queue: [],
    trace: [],
    timerOrder,
    previousButtonValues: new Map(
      scene.inputActions
        .filter((action) => action.valueType === "button")
        .map((action) => [action.id, false]),
    ),
    tick: 0,
    signalDispatches: 0,
    nextSequence: 1,
    started: false,
    dispatchLimitReached: false,
    executionLimitReached: false,
    traceLimitReached: false,
    droppedTraceEntries: 0,
    firstRetainedSequence: 1,
    cascadeSignalDispatches: 0,
    cascadeExecutions: 0,
    cascadeBlocked: false,
  };
}

export function startLogicRuntime(runtime) {
  if (runtime.started) return snapshotLogicRuntime(runtime);
  runtime.started = true;
  for (const timer of runtime.timerOrder) timer.running = true;
  for (const actionId of runtime.previousButtonValues.keys()) runtime.previousButtonValues.set(actionId, false);
  beginCascade(runtime);
  processTrigger(runtime, "play-started", null, null, -1);
  drainSignals(runtime);
  return snapshotLogicRuntime(runtime);
}

export function stepLogicRuntime(runtime, inputValues = {}) {
  if (!runtime.started) startLogicRuntime(runtime);
  runtime.tick += 1;
  beginCascade(runtime);
  processInputActions(runtime, inputValues);
  processTimers(runtime);
  drainSignals(runtime);
  return snapshotLogicRuntime(runtime);
}

export function emitLogicSignal(runtime, signalId, payload) {
  if (!runtime.started) startLogicRuntime(runtime);
  beginCascade(runtime);
  const signal = runtime.signals.get(signalId);
  if (!signal) throw new Error("Cannot emit missing signal " + signalId + ".");
  if (payload.length !== signal.fields.length) throw new Error("Signal " + signalId + " payload does not match its fields.");
  const values = new Map();
  for (let index = 0; index < signal.fields.length; index += 1) {
    const field = signal.fields[index];
    const binding = payload[index];
    if (binding.fieldId !== field.id || binding.value.type !== field.valueType) {
      throw new Error("Signal " + signalId + " payload does not match field " + field.id + ".");
    }
    values.set(field.id, cloneValue(binding.value));
  }
  runtime.queue.push({ signalId, payload: values, causedBy: -1 });
  drainSignals(runtime);
  return snapshotLogicRuntime(runtime);
}

export function snapshotLogicRuntime(runtime) {
  const snapshotVariable = (variable) => ({
    scope: variable.scope,
    objectId: variable.objectId,
    variableId: variable.definition.id,
    name: variable.definition.name,
    value: cloneValue(variable.value),
  });
  return {
    tick: runtime.tick,
    signalDispatches: runtime.signalDispatches,
    dispatchLimitReached: runtime.dispatchLimitReached,
    executionLimitReached: runtime.executionLimitReached,
    traceLimitReached: runtime.traceLimitReached,
    droppedTraceEntries: runtime.droppedTraceEntries,
    firstRetainedSequence: runtime.firstRetainedSequence,
    projectVariables: runtime.projectVariableOrder.map(snapshotVariable),
    objectVariables: runtime.objectVariableOrder.map(snapshotVariable),
    timers: runtime.timerOrder.map((timer) => ({
      objectId: timer.ownerObjectId,
      componentId: timer.definition.id,
      enabled: timer.definition.enabled,
      durationTicks: timer.definition.durationTicks,
      repeat: timer.definition.repeat,
      elapsedTicks: timer.elapsedTicks,
      running: timer.running,
      finishCount: timer.finishCount,
    })),
    trace: structuredClone(runtime.trace),
  };
}

export function explainLogicEvent(runtime, ownerObjectId, eventId) {
  const eventEntry = [...runtime.trace].reverse().find((entry) => entry.ownerObjectId === ownerObjectId && entry.eventId === eventId && entry.nodeId === eventId);
  if (!eventEntry) return "This Event has not received its trigger in the current Play run.";
  if (eventEntry.outcome === "executed") return "This Event ran successfully.";
  const failed = runtime.trace.find((entry) => entry.causedBy === eventEntry.sequence && entry.outcome === "failed");
  if (failed?.reason === "values-not-equal" && failed.actual && failed.expected) {
    return "Condition " + (failed.nodeId ?? "check") + " failed: " + formatRuntimeValue(failed.actual) + " did not equal " + formatRuntimeValue(failed.expected) + ".";
  }
  if (failed?.reason === "values-equal" && failed.actual && failed.expected) {
    return "Condition " + (failed.nodeId ?? "check") + " failed: " + formatRuntimeValue(failed.actual) + " equalled " + formatRuntimeValue(failed.expected) + " but they must differ.";
  }
  if (failed?.reason === "value-below-minimum" && failed.actual && failed.expected) {
    return "Condition " + (failed.nodeId ?? "check") + " failed: " + formatRuntimeValue(failed.actual) + " was below " + formatRuntimeValue(failed.expected) + ".";
  }
  if (failed?.reason === "value-above-maximum" && failed.actual && failed.expected) {
    return "Condition " + (failed.nodeId ?? "check") + " failed: " + formatRuntimeValue(failed.actual) + " was above " + formatRuntimeValue(failed.expected) + ".";
  }
  if (eventEntry.reason === "owner-not-visible") return "This Event was skipped because its object or a parent is hidden.";
  if (eventEntry.reason === "component-disabled") return "This Event was skipped because Object Logic is disabled.";
  if (eventEntry.reason === "event-disabled") return "This Event is disabled.";
  return "This Event did not complete: " + (failed?.reason ?? eventEntry.reason) + ".";
}

function beginCascade(runtime) {
  runtime.cascadeSignalDispatches = 0;
  runtime.cascadeExecutions = 0;
  runtime.cascadeBlocked = false;
}

function processInputActions(runtime, inputValues) {
  const risingActionIds = [];
  for (const action of runtime.scene.inputActions) {
    if (action.valueType !== "button") continue;
    const current = inputValues[action.id] === true;
    const previous = runtime.previousButtonValues.get(action.id) ?? false;
    runtime.previousButtonValues.set(action.id, current);
    if (current && !previous) risingActionIds.push(action.id);
  }
  for (const actionId of risingActionIds) {
    if (runtime.cascadeBlocked) return;
    const cause = addTrace(
      runtime,
      null,
      null,
      actionId,
      -1,
      "executed",
      "input-action-pressed",
      booleanValue(true),
      booleanValue(false),
    );
    if (!runtime.cascadeBlocked) {
      processTrigger(runtime, "input-action-pressed", null, null, cause.sequence, actionId);
    }
  }
}

function processTimers(runtime) {
  for (const timer of runtime.timerOrder) {
    if (runtime.cascadeBlocked) return;
    if (!timer.running || !timer.definition.enabled || !isEffectivelyVisible(runtime, timer.ownerObjectId)) continue;
    timer.elapsedTicks += 1;
    if (timer.elapsedTicks < timer.definition.durationTicks) continue;
    timer.finishCount += 1;
    const cause = addTrace(
      runtime,
      timer.ownerObjectId,
      null,
      timer.definition.id,
      -1,
      "executed",
      "timer-finished",
      numberValue(timer.elapsedTicks),
      numberValue(timer.definition.durationTicks),
    );
    if (timer.definition.repeat) timer.elapsedTicks = 0;
    else timer.running = false;
    if (runtime.cascadeBlocked) return;
    const owner = runtime.objects.get(timer.ownerObjectId);
    if (owner) processOwnerTrigger(runtime, owner, "timer-finished", null, null, cause.sequence);
  }
}

function processTrigger(runtime, triggerType, signalId, payload, causedBy, actionId = null) {
  for (const event of runtime.scene.projectEvents) {
    if (runtime.cascadeBlocked) return;
    if (!triggerMatches(event, triggerType, signalId, actionId)) continue;
    executeEvent(runtime, null, null, event, payload, causedBy, triggerType);
  }
  for (const owner of runtime.scene.objects) {
    if (runtime.cascadeBlocked) return;
    processOwnerTrigger(runtime, owner, triggerType, signalId, payload, causedBy, actionId);
  }
}

function processOwnerTrigger(runtime, owner, triggerType, signalId, payload, causedBy, actionId = null) {
  const component = logicComponent(owner);
  if (!component) return;
  for (const event of component.events) {
    if (runtime.cascadeBlocked) return;
    if (!triggerMatches(event, triggerType, signalId, actionId)) continue;
    executeEvent(runtime, owner, component, event, payload, causedBy, triggerType);
  }
}

function triggerMatches(event, triggerType, signalId, actionId) {
  if (event.when.type !== triggerType) return false;
  if (triggerType === "signal-received") return event.when.signalId === signalId;
  if (triggerType === "input-action-pressed") return event.when.actionId === actionId;
  return true;
}

function executeEvent(runtime, owner, component, event, signalPayload, causedBy, triggerType) {
  const ownerObjectId = owner?.id ?? null;
  const eventTrace = addTrace(runtime, ownerObjectId, event.id, event.id, causedBy, "evaluating", triggerType);
  if (runtime.cascadeBlocked) return;
  if (owner && !isEffectivelyVisible(runtime, owner.id)) {
    eventTrace.outcome = "skipped";
    eventTrace.reason = "owner-not-visible";
    return;
  }
  if (component && !component.enabled) {
    eventTrace.outcome = "skipped";
    eventTrace.reason = "component-disabled";
    return;
  }
  if (!event.enabled) {
    eventTrace.outcome = "skipped";
    eventTrace.reason = "event-disabled";
    return;
  }
  for (const condition of event.if) {
    const actual = resolveSource(runtime, condition.left, signalPayload);
    const expected = resolveSource(runtime, condition.right, signalPayload);
    if (!actual.value || !expected.value) {
      addTrace(runtime, ownerObjectId, event.id, condition.id, eventTrace.sequence, "failed", actual.failure ?? expected.failure ?? "value-source-failed", actual.value, expected.value);
      eventTrace.outcome = "skipped";
      eventTrace.reason = "condition-failed";
      return;
    }
    const result = evaluateCondition(condition, actual.value, expected.value);
    if (!result.passed) {
      addTrace(runtime, ownerObjectId, event.id, condition.id, eventTrace.sequence, "failed", result.reason, actual.value, expected.value);
      eventTrace.outcome = "skipped";
      eventTrace.reason = "condition-failed";
      return;
    }
    addTrace(runtime, ownerObjectId, event.id, condition.id, eventTrace.sequence, "passed", result.reason, actual.value, expected.value);
    if (runtime.cascadeBlocked) return;
  }
  for (const action of event.do) {
    if (runtime.cascadeBlocked) return;
    if (action.type === "set-variable") {
      const variable = resolveVariable(runtime, action.variable);
      const resolved = resolveSource(runtime, action.value, signalPayload);
      if (!variable || !resolved.value) {
        addTrace(runtime, ownerObjectId, event.id, action.id, eventTrace.sequence, "failed", variable ? resolved.failure ?? "value-source-failed" : "variable-not-found", resolved.value, null, variable?.value ?? null);
        eventTrace.outcome = "failed";
        eventTrace.reason = "action-failed";
        return;
      }
      if (variable.value.type !== resolved.value.type) {
        addTrace(runtime, ownerObjectId, event.id, action.id, eventTrace.sequence, "failed", "value-type-mismatch", resolved.value, variable.value, variable.value);
        eventTrace.outcome = "failed";
        eventTrace.reason = "action-failed";
        return;
      }
      const before = cloneValue(variable.value);
      variable.value = cloneValue(resolved.value);
      addTrace(runtime, ownerObjectId, event.id, action.id, eventTrace.sequence, "executed", "variable-set", null, null, before, variable.value);
      continue;
    }
    if (action.type === "change-number") {
      const variable = resolveVariable(runtime, action.variable);
      const resolved = resolveSource(runtime, action.amount, signalPayload);
      if (!variable || !resolved.value) {
        addTrace(runtime, ownerObjectId, event.id, action.id, eventTrace.sequence, "failed", variable ? resolved.failure ?? "value-source-failed" : "variable-not-found", resolved.value, null, variable?.value ?? null);
        eventTrace.outcome = "failed";
        eventTrace.reason = "action-failed";
        return;
      }
      if (variable.value.type !== "number" || resolved.value.type !== "number") {
        addTrace(runtime, ownerObjectId, event.id, action.id, eventTrace.sequence, "failed", "number-type-mismatch", resolved.value, numberValue(0), variable.value);
        eventTrace.outcome = "failed";
        eventTrace.reason = "action-failed";
        return;
      }
      const before = cloneValue(variable.value);
      const nextNumber = variable.value.number + resolved.value.number;
      if (!Number.isFinite(nextNumber) || Math.abs(nextNumber) > 1000000000) {
        addTrace(runtime, ownerObjectId, event.id, action.id, eventTrace.sequence, "failed", "number-change-out-of-range", resolved.value, null, before);
        eventTrace.outcome = "failed";
        eventTrace.reason = "action-failed";
        return;
      }
      variable.value = numberValue(nextNumber);
      addTrace(runtime, ownerObjectId, event.id, action.id, eventTrace.sequence, "executed", "number-changed", resolved.value, null, before, variable.value);
      continue;
    }
    if (action.type === "emit-signal") {
      const signal = runtime.signals.get(action.signalId);
      if (!signal) {
        addTrace(runtime, ownerObjectId, event.id, action.id, eventTrace.sequence, "failed", "signal-not-found");
        eventTrace.outcome = "failed";
        eventTrace.reason = "action-failed";
        return;
      }
      const nextPayload = new Map();
      let failure = "";
      for (let index = 0; index < signal.fields.length; index += 1) {
        const field = signal.fields[index];
        const binding = action.payload[index];
        const resolved = resolveSource(runtime, binding.value, signalPayload);
        if (binding.fieldId !== field.id || !resolved.value || resolved.value.type !== field.valueType) {
          failure = resolved.failure ?? "signal-payload-mismatch";
          break;
        }
        nextPayload.set(field.id, cloneValue(resolved.value));
      }
      if (failure) {
        addTrace(runtime, ownerObjectId, event.id, action.id, eventTrace.sequence, "failed", failure);
        eventTrace.outcome = "failed";
        eventTrace.reason = "action-failed";
        return;
      }
      const emission = addTrace(runtime, ownerObjectId, event.id, action.id, eventTrace.sequence, "executed", "signal-enqueued");
      if (!runtime.cascadeBlocked) runtime.queue.push({ signalId: signal.id, payload: nextPayload, causedBy: emission.sequence });
      continue;
    }
    addTrace(runtime, ownerObjectId, event.id, action.id, eventTrace.sequence, "failed", "unsupported-action");
    eventTrace.outcome = "failed";
    eventTrace.reason = "action-failed";
    return;
  }
  if (!runtime.cascadeBlocked) {
    eventTrace.outcome = "executed";
    eventTrace.reason = "completed";
  }
}

function drainSignals(runtime) {
  while (runtime.queue.length && !runtime.cascadeBlocked) {
    const pending = runtime.queue.shift();
    if (runtime.cascadeSignalDispatches >= MAX_LOGIC_SIGNAL_DISPATCHES) {
      runtime.dispatchLimitReached = true;
      addTrace(runtime, null, null, pending.signalId, pending.causedBy, "blocked", "signal-dispatch-limit");
      runtime.queue.length = 0;
      return;
    }
    runtime.cascadeSignalDispatches += 1;
    runtime.signalDispatches += 1;
    processTrigger(runtime, "signal-received", pending.signalId, pending.payload, pending.causedBy);
  }
}

function resolveSource(runtime, source, signalPayload) {
  if (source.kind === "literal") return { value: cloneValue(source.value), failure: null };
  if (source.kind === "variable") {
    const variable = resolveVariable(runtime, source.reference);
    return variable ? { value: cloneValue(variable.value), failure: null } : { value: null, failure: "variable-not-found" };
  }
  const value = signalPayload?.get(source.fieldId);
  return value ? { value: cloneValue(value), failure: null } : { value: null, failure: signalPayload ? "signal-field-not-found" : "signal-payload-unavailable" };
}

function resolveVariable(runtime, reference) {
  return reference.scope === "project"
    ? runtime.projectVariables.get(reference.variableId) ?? null
    : runtime.objectVariables.get(objectVariableKey(reference.objectId, reference.variableId)) ?? null;
}

function isEffectivelyVisible(runtime, objectId) {
  const visited = new Set();
  let object = runtime.objects.get(objectId);
  while (object) {
    if (visited.has(object.id) || !object.visible) return false;
    visited.add(object.id);
    object = object.parentId === null ? undefined : runtime.objects.get(object.parentId);
  }
  return true;
}

function addTrace(runtime, ownerObjectId, eventId, nodeId, causedBy, outcome, reason, actual = null, expected = null, before = null, after = null) {
  if (runtime.cascadeBlocked) return detachedTrace();
  if (runtime.cascadeExecutions >= MAX_LOGIC_CASCADE_EXECUTIONS) {
    runtime.executionLimitReached = true;
    runtime.cascadeBlocked = true;
    runtime.queue.length = 0;
    appendTrace(runtime, {
      sequence: runtime.nextSequence++,
      tick: runtime.tick,
      ownerObjectId: null,
      eventId: null,
      nodeId: "execution-limit",
      causedBy,
      outcome: "blocked",
      reason: "execution-cascade-limit",
      actual: null,
      expected: null,
      before: null,
      after: null,
    });
    return detachedTrace();
  }
  runtime.cascadeExecutions += 1;
  const entry = {
    sequence: runtime.nextSequence++,
    tick: runtime.tick,
    ownerObjectId,
    eventId,
    nodeId,
    causedBy,
    outcome,
    reason,
    actual: actual ? cloneValue(actual) : null,
    expected: expected ? cloneValue(expected) : null,
    before: before ? cloneValue(before) : null,
    after: after ? cloneValue(after) : null,
  };
  appendTrace(runtime, entry);
  return entry;
}

function appendTrace(runtime, entry) {
  runtime.trace.push(entry);
  while (runtime.trace.length > MAX_LOGIC_TRACE_ENTRIES) {
    runtime.trace.shift();
    runtime.droppedTraceEntries += 1;
    runtime.traceLimitReached = true;
  }
  runtime.firstRetainedSequence = runtime.trace[0]?.sequence ?? runtime.nextSequence;
}

function detachedTrace() {
  return {
    sequence: -1,
    tick: -1,
    ownerObjectId: null,
    eventId: null,
    nodeId: null,
    causedBy: -1,
    outcome: "blocked",
    reason: "cascade-blocked",
    actual: null,
    expected: null,
    before: null,
    after: null,
  };
}

function logicComponent(object) {
  return object?.components.find((component) => component.type === "logic") ?? null;
}

function timerComponent(object) {
  return object?.components.find((component) => component.type === "timer") ?? null;
}

function cloneValue(value) {
  return structuredClone(value);
}

function evaluateCondition(condition, actual, expected) {
  if (actual.type !== expected.type) return { passed: false, reason: "value-type-mismatch" };
  if (condition.type === "equals") {
    const passed = valuesEqual(actual, expected);
    return { passed, reason: passed ? "values-equal" : "values-not-equal" };
  }
  if (condition.type === "not-equals") {
    const passed = !valuesEqual(actual, expected);
    return { passed, reason: passed ? "values-not-equal" : "values-equal" };
  }
  if (actual.type !== "number" || expected.type !== "number") return { passed: false, reason: "number-type-mismatch" };
  if (condition.type === "at-least") {
    const passed = actual.number >= expected.number;
    return { passed, reason: passed ? "value-at-least" : "value-below-minimum" };
  }
  const passed = actual.number <= expected.number;
  return { passed, reason: passed ? "value-at-most" : "value-above-maximum" };
}

function valuesEqual(left, right) {
  if (left.type !== right.type) return false;
  if (left.type === "number" && right.type === "number") return left.number === right.number;
  if (left.type === "boolean" && right.type === "boolean") return left.boolean === right.boolean;
  if (left.type === "string" && right.type === "string") return left.text === right.text;
  if (left.type === "object-ref" && right.type === "object-ref") return left.objectId === right.objectId;
  return left.type === "asset-ref" && right.type === "asset-ref" && left.assetId === right.assetId;
}

function numberValue(number) {
  return { type: "number", number };
}

function booleanValue(boolean) {
  return { type: "boolean", boolean };
}

function objectVariableKey(objectId, variableId) {
  return objectId + "\u001f" + variableId;
}

function formatRuntimeValue(value) {
  if (value.type === "number") return String(value.number);
  if (value.type === "boolean") return value.boolean ? "True" : "False";
  if (value.type === "string") return "“" + value.text + "”";
  if (value.type === "object-ref") return value.objectId;
  return value.assetId;
}
`;

// src/projectBuilder.ts
var SCENE_SCHEMA = "game-port-studio/scene@0.14";
var MAX_SCENE_OBJECTS = 500;
var MAX_SCENE_DEPTH = 64;
var SAFE_ID2 = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
var SAFE_MODEL_ASSET_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:obj|glb)$/i;
var SAFE_IMAGE_ASSET_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|jpe?g)$/i;
var HEX_COLOR = /^#[0-9a-f]{6}$/i;
var MAX_PROJECT_NAME = 80;
var MAX_COMPONENTS_PER_OBJECT = 16;
var MAX_THREE_SOURCE_BYTES = 12 * 1024 * 1024;
var MAX_OBJ_LOADER_BYTES = 2 * 1024 * 1024;
var MAX_OBJ_SOURCE_BYTES = 2 * 1024 * 1024;
var MAX_GLB_SOURCE_BYTES = 10 * 1024 * 1024;
var MAX_IMAGE_SOURCE_BYTES = 10 * 1024 * 1024;
var MAX_SCENE_ASSETS = 128;
var MAX_SCENE_ASSET_BYTES = 64 * 1024 * 1024;
var MAX_SCENE_INPUT_ACTIONS = 16;
var MAX_TIMER_DURATION_TICKS = 60 * 60 * 60;
var PRIMITIVE_TYPES = ["plane", "cube", "sphere", "cylinder", "capsule"];
var VECTOR2_INPUT_BINDINGS = ["keyboard-wasd-arrows", "gamepad-left-stick", "touch-virtual-stick"];
var BUTTON_INPUT_BINDINGS = ["keyboard-space-enter", "gamepad-south-button", "touch-action-button"];
function meshRendererComponent(object) {
  return object.components.find((component) => component.type === "mesh-renderer") ?? null;
}
function cameraComponent(object) {
  return object.components.find((component) => component.type === "camera") ?? null;
}
function sanitizeObjSource(source) {
  if (typeof source !== "string" || !source.trim()) throw new Error("That OBJ file is empty.");
  if (source.includes("\0")) throw new Error("That OBJ file contains binary data. Choose a text OBJ file.");
  if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(source)) throw new Error("That OBJ file contains an unsupported control character.");
  const normalized = source.replace(/\r\n?/g, "\n");
  const bytes = new TextEncoder().encode(normalized).byteLength;
  if (bytes > MAX_OBJ_SOURCE_BYTES) throw new Error("That OBJ file exceeds the 2 MB editor import limit.");
  const lines = normalized.split("\n");
  validateObjGeometry(lines);
  const selfContained = normalized.split("\n").filter((line) => !/^\s*(?:mtllib|usemtl|usemap)\b/i.test(line)).join("\n").trimEnd() + "\n";
  return selfContained;
}
function sceneAssetBytes(asset) {
  if (asset.type === "model" && asset.format === "obj") return new TextEncoder().encode(asset.source);
  if (typeof asset.source !== "string" || !isCanonicalBase64(asset.source)) {
    throw new Error(`The ${asset.type === "image" ? "image" : "GLB model"} data is not canonical base64.`);
  }
  const binary = atob(asset.source);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function validateImageBytes(bytes, format) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error("That image file is empty.");
  if (bytes.byteLength > MAX_IMAGE_SOURCE_BYTES) throw new Error("That image file exceeds the 10 MB editor import limit.");
  if (format === "png") {
    validatePngBytes(bytes);
    return;
  }
  if (format === "jpeg") {
    validateJpegBytes(bytes);
    return;
  }
  throw new Error(`Unsupported image format: ${String(format)}.`);
}
function validateGlbBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 20) throw new Error("That GLB file is empty or truncated.");
  if (bytes.byteLength > MAX_GLB_SOURCE_BYTES) throw new Error("That GLB file exceeds the 10 MB editor import limit.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 1179937895 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) {
    throw new Error("That file is not a complete GLB 2.0 model.");
  }
  const chunks = [];
  let offset = 12;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error("That GLB file has a truncated chunk header.");
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (length % 4 !== 0) throw new Error("That GLB file has a chunk whose length is not aligned to four bytes.");
    offset += 8;
    if (length > bytes.byteLength - offset) throw new Error("That GLB file has a truncated chunk payload.");
    chunks.push({ type, offset, length });
    offset += length;
  }
  const JSON_CHUNK = 1313821514;
  const BIN_CHUNK = 5130562;
  if (!chunks.length || chunks[0].type !== JSON_CHUNK) throw new Error("That GLB file must begin with one JSON chunk.");
  if (chunks.filter((chunk) => chunk.type === JSON_CHUNK).length !== 1) throw new Error("That GLB file must contain exactly one JSON chunk.");
  if (chunks.filter((chunk) => chunk.type === BIN_CHUNK).length > 1) throw new Error("That GLB file contains more than one BIN chunk.");
  let jsonText;
  try {
    jsonText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes.subarray(chunks[0].offset, chunks[0].offset + chunks[0].length));
  } catch {
    throw new Error("That GLB file contains invalid UTF-8 JSON data.");
  }
  let json;
  try {
    const parsed = JSON.parse(jsonText.trimEnd());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    json = parsed;
  } catch {
    throw new Error("That GLB file contains malformed JSON data.");
  }
  const asset = json.asset;
  if (!asset || asset.version !== "2.0" || typeof asset.minVersion === "string" && compareGltfVersions(asset.minVersion, "2.0") > 0) {
    throw new Error("That GLB file does not declare a supported glTF 2.0 asset.");
  }
  rejectExternalGlbUris(json);
  const bin = chunks.find((chunk) => chunk.type === BIN_CHUNK);
  const buffers = json.buffers === void 0 ? [] : json.buffers;
  if (!Array.isArray(buffers)) throw new Error("That GLB file has an invalid buffers collection.");
  const bufferLengths = buffers.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`That GLB file has an invalid buffer at index ${index}.`);
    const record = value;
    if (!Number.isSafeInteger(record.byteLength) || record.byteLength < 0) throw new Error(`That GLB file has an invalid buffer length at index ${index}.`);
    if (index === 0 && !("uri" in record) && record.byteLength > (bin?.length ?? 0)) throw new Error("That GLB file declares more binary data than its BIN chunk contains.");
    return record.byteLength;
  });
  const bufferViews = json.bufferViews === void 0 ? [] : json.bufferViews;
  if (!Array.isArray(bufferViews)) throw new Error("That GLB file has an invalid bufferViews collection.");
  for (let index = 0; index < bufferViews.length; index += 1) {
    const value = bufferViews[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`That GLB file has an invalid bufferView at index ${index}.`);
    const record = value;
    const bufferIndex = record.buffer;
    const byteOffset = record.byteOffset ?? 0;
    const byteLength = record.byteLength;
    if (!Number.isSafeInteger(bufferIndex) || bufferIndex < 0 || bufferIndex >= bufferLengths.length || !Number.isSafeInteger(byteOffset) || byteOffset < 0 || !Number.isSafeInteger(byteLength) || byteLength < 0 || byteOffset + byteLength > bufferLengths[bufferIndex]) {
      throw new Error(`That GLB file has an out-of-range bufferView at index ${index}.`);
    }
  }
  const images = json.images === void 0 ? [] : json.images;
  if (!Array.isArray(images)) throw new Error("That GLB file has an invalid images collection.");
  for (let index = 0; index < images.length; index += 1) {
    const value = images[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`That GLB file has an invalid image at index ${index}.`);
    const record = value;
    if ("bufferView" in record) {
      if (!Number.isSafeInteger(record.bufferView) || record.bufferView < 0 || record.bufferView >= bufferViews.length) {
        throw new Error(`That GLB file has an out-of-range image bufferView at index ${index}.`);
      }
      if (record.mimeType !== "image/png" && record.mimeType !== "image/jpeg") {
        throw new Error("Embedded GLB images must use PNG or JPEG data.");
      }
    }
  }
}
function isCanonicalBase64(value) {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try {
    return btoa(atob(value)) === value;
  } catch {
    return false;
  }
}
function validatePngBytes(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 45 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error("That file is not a complete PNG image.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let chunkIndex = 0;
  let sawIdat = false;
  let sawIend = false;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw new Error("That PNG image has a truncated chunk.");
    const length = view.getUint32(offset, false);
    if (length > bytes.byteLength - offset - 12) throw new Error("That PNG image has a truncated chunk payload.");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error("That PNG image has an invalid chunk type.");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const storedCrc = view.getUint32(dataEnd, false);
    const actualCrc = pngCrc32(bytes.subarray(offset + 4, dataEnd));
    if (storedCrc !== actualCrc) throw new Error(`That PNG image has a corrupt ${type} chunk.`);
    if (chunkIndex === 0) {
      if (type !== "IHDR" || length !== 13) throw new Error("That PNG image must begin with one IHDR chunk.");
      const width = view.getUint32(dataStart, false);
      const height = view.getUint32(dataStart + 4, false);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      if (!width || !height || width > 16384 || height > 16384) throw new Error("That PNG image has unsupported dimensions.");
      if (![0, 2, 3, 4, 6].includes(colorType) || !validPngBitDepth(colorType, bitDepth)) throw new Error("That PNG image has an unsupported colour format.");
      if (bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0 || bytes[dataStart + 12] > 1) throw new Error("That PNG image uses unsupported compression, filtering, or interlacing.");
    } else if (type === "IHDR") {
      throw new Error("That PNG image contains more than one IHDR chunk.");
    }
    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") {
      if (length !== 0 || !sawIdat || dataEnd + 4 !== bytes.byteLength) throw new Error("That PNG image has an invalid IEND boundary.");
      sawIend = true;
    }
    if (sawIend) break;
    offset = dataEnd + 4;
    chunkIndex += 1;
  }
  if (!sawIend) throw new Error("That PNG image is missing its IEND chunk.");
}
function validPngBitDepth(colorType, bitDepth) {
  const allowed = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  };
  return allowed[colorType]?.includes(bitDepth) === true;
}
function pngCrc32(bytes) {
  let crc = 4294967295;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc >>> 1 ^ (crc & 1 ? 3988292384 : 0);
  }
  return (crc ^ 4294967295) >>> 0;
}
function validateJpegBytes(bytes) {
  if (bytes.byteLength < 16 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) {
    throw new Error("That file is not a complete JPEG image.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const startOfFrame = /* @__PURE__ */ new Set([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]);
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 255) throw new Error("That JPEG image has an invalid marker boundary.");
    while (offset < bytes.length && bytes[offset] === 255) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0 || marker === 216 || marker === 217 || marker === void 0) throw new Error("That JPEG image has an invalid marker.");
    if (marker >= 208 && marker <= 215) continue;
    if (offset + 2 > bytes.length) throw new Error("That JPEG image has a truncated segment.");
    const length = view.getUint16(offset, false);
    if (length < 2 || offset + length > bytes.length) throw new Error("That JPEG image has a truncated segment payload.");
    if (startOfFrame.has(marker)) {
      if (length < 8) throw new Error("That JPEG image has a truncated frame header.");
      const height = view.getUint16(offset + 3, false);
      const width = view.getUint16(offset + 5, false);
      if (!width || !height || width > 16384 || height > 16384) throw new Error("That JPEG image has unsupported dimensions.");
      sawFrame = true;
    }
    offset += length;
    if (marker !== 218) continue;
    sawScan = true;
    while (offset < bytes.length - 2) {
      if (bytes[offset] !== 255) {
        offset += 1;
        continue;
      }
      let markerOffset = offset + 1;
      while (markerOffset < bytes.length && bytes[markerOffset] === 255) markerOffset += 1;
      const scanMarker = bytes[markerOffset];
      if (scanMarker === 0) {
        offset = markerOffset + 1;
        continue;
      }
      if (scanMarker >= 208 && scanMarker <= 215) {
        offset = markerOffset + 1;
        continue;
      }
      offset = markerOffset - 1;
      break;
    }
  }
  if (!sawFrame || !sawScan) throw new Error("That JPEG image is missing its frame or scan data.");
}
function compareGltfVersions(left, right) {
  const parse = (value) => value.split(".").map((part) => /^\d+$/.test(part) ? Number(part) : Number.NaN);
  const a = parse(left);
  const b = parse(right);
  if (a.some((part) => !Number.isFinite(part))) return 1;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
function rejectExternalGlbUris(value) {
  if (Array.isArray(value)) {
    for (const item of value) rejectExternalGlbUris(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "uri" && typeof child === "string" && !/^data:/i.test(child)) {
      throw new Error("GLB models with external URI dependencies are not supported.");
    }
    rejectExternalGlbUris(child);
  }
}
function validateObjGeometry(lines) {
  let vertices = 0;
  let textureCoordinates = 0;
  let normals = 0;
  let faces = 0;
  const faceReferences = [];
  for (const line of lines) {
    if (line.length > 16384) throw new Error("That OBJ file contains a line longer than 16 KB.");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const tokens = trimmed.split(/\s+/);
    const keyword = tokens[0].toLowerCase();
    if (keyword === "v") {
      validateObjNumbers(tokens.slice(1), 3, 4, "vertex");
      vertices += 1;
      if (vertices > 5e4) throw new Error("That OBJ file exceeds the 50,000 vertex limit.");
    } else if (keyword === "vt") {
      validateObjNumbers(tokens.slice(1), 1, 3, "texture coordinate");
      textureCoordinates += 1;
    } else if (keyword === "vn") {
      validateObjNumbers(tokens.slice(1), 3, 3, "normal");
      normals += 1;
    } else if (keyword === "f") {
      if (tokens.length !== 4) throw new Error("This first OBJ importer accepts triangular faces only.");
      faces += 1;
      if (faces > 1e5) throw new Error("That OBJ file exceeds the 100,000 triangle limit.");
      faceReferences.push({ tokens: tokens.slice(1), vertices, textureCoordinates, normals });
    } else if (["l", "p", "curv", "curv2", "surf"].includes(keyword)) {
      throw new Error("This first OBJ importer accepts mesh faces, not lines, points, or curves.");
    } else if (!["o", "g", "s", "mtllib", "usemtl", "usemap"].includes(keyword)) {
      throw new Error(`This first OBJ importer does not support the ${keyword} directive.`);
    }
  }
  if (!vertices) throw new Error("That OBJ file has no readable vertices.");
  if (!faces) throw new Error("That OBJ file has no readable faces.");
  for (const face of faceReferences) {
    for (const token of face.tokens) {
      const parts = token.split("/");
      if (parts.length > 3) throw new Error("That OBJ file contains an invalid face reference.");
      validateObjIndex(parts[0], face.vertices, "vertex");
      if (parts[1]) validateObjIndex(parts[1], face.textureCoordinates, "texture coordinate");
      if (parts[2]) validateObjIndex(parts[2], face.normals, "normal");
    }
  }
}
function validateObjNumbers(values, minimumCount, maximumCount, label) {
  if (values.length < minimumCount || values.length > maximumCount || values.some((value) => !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1e6)) {
    throw new Error(`That OBJ file contains an invalid ${label}.`);
  }
}
function validateObjIndex(raw, countAtFace, label) {
  if (!/^[+-]?\d+$/.test(raw)) throw new Error(`That OBJ file contains an invalid ${label} index.`);
  const index = Number(raw);
  const valid = index > 0 ? index <= countAtFace : index < 0 && Math.abs(index) <= countAtFace;
  if (!valid) throw new Error(`That OBJ file contains an out-of-range ${label} index.`);
}
function validateProjectName(projectName) {
  if (typeof projectName !== "string") throw new Error("Project name must be text.");
  const name = projectName.trim();
  if (!name) throw new Error("Project name is required.");
  if (name.length > MAX_PROJECT_NAME) throw new Error(`Project name must be ${MAX_PROJECT_NAME} characters or fewer.`);
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("Project name contains a control character.");
  let decoded;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    throw new Error("Project name contains invalid percent encoding.");
  }
  if (decoded === "." || decoded === ".." || /[\\/]/.test(decoded) || /^[a-z]:/i.test(decoded)) {
    throw new Error("Project name must not contain a path, drive, or traversal segment.");
  }
  return name;
}
function validateScene(scene) {
  if (!scene || typeof scene !== "object") throw new Error("A scene document is required.");
  if (scene.schema !== SCENE_SCHEMA) throw new Error(`Unsupported scene schema: ${String(scene.schema)}.`);
  validateProjectName(scene.name);
  validateColor(scene.background, "scene background");
  const sceneRecord = scene;
  if ("camera" in sceneRecord || "light" in sceneRecord) throw new Error("Scene contains legacy global camera or light data.");
  validateExactKeys2(scene, ["schema", "name", "background", "activeCameraId", "inputActions", "projectVariables", "signals", "projectEvents", "assets", "objects"], "Scene");
  if (typeof scene.activeCameraId !== "string" || !SAFE_ID2.test(scene.activeCameraId)) throw new Error("Scene active camera id is invalid.");
  if (!Array.isArray(scene.inputActions)) throw new Error("Scene input actions must be a list.");
  if (scene.inputActions.length > MAX_SCENE_INPUT_ACTIONS) throw new Error(`Scene cannot contain more than ${MAX_SCENE_INPUT_ACTIONS} input actions.`);
  const inputActionIds = /* @__PURE__ */ new Set();
  const exactInputActionIds = /* @__PURE__ */ new Set();
  const inputActionsById = /* @__PURE__ */ new Map();
  let touchVirtualStickActionId = null;
  for (const action of scene.inputActions) {
    if (!action || typeof action !== "object" || !SAFE_ID2.test(action.id)) throw new Error("Scene contains an invalid input action id.");
    const actionId = action.id.toLowerCase();
    if (inputActionIds.has(actionId)) throw new Error(`Duplicate scene input action id: ${action.id}.`);
    inputActionIds.add(actionId);
    exactInputActionIds.add(action.id);
    inputActionsById.set(action.id, action);
    validateExactKeys2(action, ["id", "name", "valueType", "bindings"], `Input action ${action.id}`);
    if (!action.name?.trim() || action.name.length > 80 || /[\u0000-\u001f\u007f]/.test(action.name)) throw new Error(`Input action ${action.id} has an invalid name.`);
    if (action.valueType !== "vector2" && action.valueType !== "button") throw new Error("Scene input actions must use the vector2 or button value type.");
    if (!Array.isArray(action.bindings) || action.bindings.length === 0) throw new Error(`Input action ${action.id} must contain at least one binding.`);
    const bindings = /* @__PURE__ */ new Set();
    const allowedBindings = action.valueType === "vector2" ? VECTOR2_INPUT_BINDINGS : BUTTON_INPUT_BINDINGS;
    for (const binding of action.bindings) {
      if (!allowedBindings.includes(binding)) throw new Error(`Input action ${action.id} contains binding ${String(binding)} that is incompatible with ${action.valueType}.`);
      if (bindings.has(binding)) throw new Error(`Input action ${action.id} contains duplicate binding ${binding}.`);
      if (binding === "touch-virtual-stick") {
        if (touchVirtualStickActionId && touchVirtualStickActionId !== action.id) throw new Error("Scene v0.14 supports one touch virtual-stick action.");
        touchVirtualStickActionId = action.id;
      }
      bindings.add(binding);
    }
  }
  if (!Array.isArray(scene.assets)) throw new Error("Scene assets must be a list.");
  if (scene.assets.length > MAX_SCENE_ASSETS) throw new Error(`Scene cannot contain more than ${MAX_SCENE_ASSETS} assets.`);
  const assetIds = /* @__PURE__ */ new Set();
  const exactAssetIds = /* @__PURE__ */ new Set();
  const assetsById = /* @__PURE__ */ new Map();
  const assetFiles = /* @__PURE__ */ new Set();
  let assetBytes = 0;
  for (const asset of scene.assets) {
    if (!asset || typeof asset !== "object" || !SAFE_ID2.test(asset.id)) throw new Error("Scene contains an invalid asset id.");
    const assetId = asset.id.toLowerCase();
    if (assetIds.has(assetId)) throw new Error(`Duplicate scene asset id: ${asset.id}.`);
    assetIds.add(assetId);
    exactAssetIds.add(asset.id);
    assetsById.set(asset.id, asset);
    if ("kind" in asset) throw new Error(`Scene asset ${asset.id} contains legacy kind data.`);
    validateExactKeys2(asset, ["id", "name", "type", "format", "fileName", "source", "bytes"], `Scene asset ${asset.id}`);
    if (asset.type !== "model" && asset.type !== "image") {
      throw new Error(`Unsupported scene asset type: ${String(asset.type)}.`);
    }
    const supportedFormat = asset.type === "model" ? asset.format === "obj" || asset.format === "glb" : asset.format === "png" || asset.format === "jpeg";
    if (!supportedFormat) throw new Error(`Unsupported scene asset format: ${String(asset.format)}.`);
    if (!asset.name?.trim() || asset.name.length > 80 || /[\u0000-\u001f\u007f]/.test(asset.name)) throw new Error(`Scene asset ${asset.id} has an invalid name.`);
    const safeFile = asset.type === "model" ? SAFE_MODEL_ASSET_FILE.test(asset.fileName) : SAFE_IMAGE_ASSET_FILE.test(asset.fileName);
    const extensionMatches = asset.format === "jpeg" ? /\.jpe?g$/i.test(asset.fileName) : asset.fileName.toLowerCase().endsWith(`.${asset.format}`);
    if (!safeFile || !extensionMatches) throw new Error(`Scene asset ${asset.id} has an unsafe ${asset.type} filename.`);
    const assetFile = asset.fileName.toLowerCase();
    if (assetFiles.has(assetFile)) throw new Error(`Duplicate scene asset filename: ${asset.fileName}.`);
    assetFiles.add(assetFile);
    if (typeof asset.source !== "string" || !asset.source.trim()) throw new Error(`Scene asset ${asset.id} is missing its ${asset.type} source.`);
    let actualBytes;
    try {
      if (asset.type === "model" && asset.format === "obj") {
        asset.source = sanitizeObjSource(asset.source);
        actualBytes = new TextEncoder().encode(asset.source).byteLength;
        asset.bytes = actualBytes;
      } else {
        const binaryBytes = sceneAssetBytes(asset);
        if (asset.type === "model") validateGlbBytes(binaryBytes);
        else validateImageBytes(binaryBytes, asset.format);
        actualBytes = binaryBytes.byteLength;
      }
    } catch (cause) {
      const detail = cause instanceof Error ? ` ${cause.message}` : "";
      throw new Error(`Scene asset ${asset.id} has unreadable ${asset.type} data.${detail}`);
    }
    const limit = asset.type === "image" ? MAX_IMAGE_SOURCE_BYTES : asset.format === "obj" ? MAX_OBJ_SOURCE_BYTES : MAX_GLB_SOURCE_BYTES;
    if (actualBytes !== asset.bytes || actualBytes > limit) throw new Error(`Scene asset ${asset.id} has invalid byte metadata.`);
    assetBytes += actualBytes;
  }
  if (assetBytes > MAX_SCENE_ASSET_BYTES) throw new Error("Scene asset data exceeds the 64 MB scene limit.");
  if (!Array.isArray(scene.objects) || scene.objects.length === 0) throw new Error("Scene must contain at least one object.");
  if (scene.objects.length > MAX_SCENE_OBJECTS) throw new Error(`Scene cannot contain more than ${MAX_SCENE_OBJECTS} objects.`);
  const ids = /* @__PURE__ */ new Set();
  const objectsById = /* @__PURE__ */ new Map();
  const enabledCameraObjects = [];
  for (const object of scene.objects) {
    if (!object || typeof object !== "object") throw new Error("Scene contains an invalid object.");
    if (!SAFE_ID2.test(object.id)) throw new Error(`Unsafe scene object id: ${String(object.id)}.`);
    const id = object.id.toLowerCase();
    if (ids.has(id)) throw new Error(`Duplicate scene object id: ${object.id}.`);
    ids.add(id);
    objectsById.set(object.id, object);
    if (!object.name?.trim() || object.name.length > 80 || /[\u0000-\u001f\u007f]/.test(object.name)) throw new Error(`Scene object ${object.id} has an invalid name.`);
    if ("type" in object || "color" in object || "assetId" in object) throw new Error(`Scene object ${object.id} contains legacy render fields.`);
    validateExactKeys2(object, ["id", "name", "parentId", "visible", "locked", "position", "rotation", "scale", "components"], `Scene object ${object.id}`);
    if (object.parentId !== null && (typeof object.parentId !== "string" || !SAFE_ID2.test(object.parentId))) {
      throw new Error(`Scene object ${object.id} has an invalid parent id.`);
    }
    if (typeof object.visible !== "boolean") throw new Error(`Scene object ${object.id} visibility must be a boolean.`);
    if (typeof object.locked !== "boolean") throw new Error(`Scene object ${object.id} locked state must be a boolean.`);
    validateVector(object.position, `${object.id} position`);
    validateVector(object.rotation, `${object.id} rotation`);
    validateVector(object.scale, `${object.id} scale`);
    if (object.scale.x === 0 || object.scale.y === 0 || object.scale.z === 0) throw new Error(`${object.id} scale components must be non-zero.`);
    if (!Array.isArray(object.components)) throw new Error(`Scene object ${object.id} components must be a list.`);
    if (object.components.length > MAX_COMPONENTS_PER_OBJECT) throw new Error(`Scene object ${object.id} cannot contain more than ${MAX_COMPONENTS_PER_OBJECT} components.`);
    const componentIds = /* @__PURE__ */ new Set();
    const componentTypes = /* @__PURE__ */ new Set();
    for (const component of object.components) {
      if (!component || typeof component !== "object" || !SAFE_ID2.test(component.id)) throw new Error(`Scene object ${object.id} contains an invalid component id.`);
      const componentId = component.id.toLowerCase();
      if (componentIds.has(componentId)) throw new Error(`Scene object ${object.id} contains duplicate component id ${component.id}.`);
      componentIds.add(componentId);
      if (componentTypes.has(component.type)) throw new Error(`Scene object ${object.id} contains more than one ${component.type} component.`);
      componentTypes.add(component.type);
      if (component.type === "mesh-renderer") {
        validateExactKeys2(component, ["id", "type", "enabled", "source", "material"], `${object.id} mesh renderer`);
        if (typeof component.enabled !== "boolean") throw new Error(`Scene object ${object.id} mesh renderer enabled state must be a boolean.`);
        if (!component.source || typeof component.source !== "object") throw new Error(`Scene object ${object.id} mesh renderer is missing a source.`);
        let modelAsset = null;
        if (component.source.kind === "primitive") {
          if (!PRIMITIVE_TYPES.includes(component.source.primitive) || "assetId" in component.source) throw new Error(`Scene object ${object.id} has unsupported primitive source.`);
          validateExactKeys2(component.source, ["kind", "primitive"], `${object.id} primitive source`);
        } else if (component.source.kind === "asset") {
          if ("primitive" in component.source || !SAFE_ID2.test(component.source.assetId) || !exactAssetIds.has(component.source.assetId)) {
            throw new Error(`Scene object ${object.id} mesh renderer references a missing asset.`);
          }
          validateExactKeys2(component.source, ["kind", "assetId"], `${object.id} asset source`);
          const referencedAsset = assetsById.get(component.source.assetId);
          if (referencedAsset?.type !== "model") throw new Error(`Scene object ${object.id} mesh renderer source must reference a model asset.`);
          modelAsset = referencedAsset;
        } else {
          throw new Error(`Scene object ${object.id} mesh renderer has unsupported source.`);
        }
        validateSceneMaterial(component.material, `${object.id} mesh renderer material`, assetsById);
        if (component.material.kind === "embedded" && modelAsset?.format !== "glb") {
          throw new Error(`Scene object ${object.id} embedded material requires a GLB model source.`);
        }
        continue;
      }
      if (component.type === "camera") {
        validateExactKeys2(component, ["id", "type", "enabled", "projection", "verticalFov", "nearClip", "farClip"], `${object.id} Camera`);
        if (typeof component.enabled !== "boolean") throw new Error(`Scene object ${object.id} Camera enabled state must be a boolean.`);
        if (component.projection !== "perspective") throw new Error(`Scene object ${object.id} Camera projection must be perspective.`);
        if (!isFiniteInRange(component.verticalFov, 1, 179)) throw new Error(`Scene object ${object.id} Camera vertical FOV must be between 1 and 179 degrees.`);
        if (!isFiniteInRange(component.nearClip, 1e-4, Number.MAX_SAFE_INTEGER)) throw new Error(`Scene object ${object.id} Camera near clip must be positive.`);
        if (!isFiniteInRange(component.farClip, 1e-4, 1e5) || component.farClip <= component.nearClip) throw new Error(`Scene object ${object.id} Camera far clip must be greater than its near clip and no more than 100000.`);
        if (component.enabled) enabledCameraObjects.push(object);
        continue;
      }
      if (component.type === "directional-light") {
        validateExactKeys2(component, ["id", "type", "enabled", "color", "intensity", "castShadows"], `${object.id} Directional Light`);
        if (typeof component.enabled !== "boolean") throw new Error(`Scene object ${object.id} Directional Light enabled state must be a boolean.`);
        validateColor(component.color, `${object.id} Directional Light color`);
        if (!isFiniteInRange(component.intensity, 0, 1e5)) throw new Error(`Scene object ${object.id} Directional Light intensity must be between 0 and 100000.`);
        if (typeof component.castShadows !== "boolean") throw new Error(`Scene object ${object.id} Directional Light castShadows must be a boolean.`);
        continue;
      }
      if (component.type === "move-from-input") {
        validateExactKeys2(component, ["id", "type", "enabled", "inputActionId", "plane", "space", "speed"], `${object.id} Move From Input`);
        if (typeof component.enabled !== "boolean") throw new Error(`Scene object ${object.id} Move From Input enabled state must be a boolean.`);
        if (!SAFE_ID2.test(component.inputActionId) || !exactInputActionIds.has(component.inputActionId)) throw new Error(`Scene object ${object.id} Move From Input references a missing input action.`);
        if (inputActionsById.get(component.inputActionId)?.valueType !== "vector2") throw new Error(`Scene object ${object.id} Move From Input requires a vector2 input action.`);
        if (component.plane !== "xy" && component.plane !== "xz") throw new Error(`Scene object ${object.id} Move From Input plane must be xy or xz.`);
        if (component.space !== "parent") throw new Error(`Scene object ${object.id} Move From Input space must be parent.`);
        if (!isFiniteInRange(component.speed, 0, 1e3)) throw new Error(`Scene object ${object.id} Move From Input speed must be between 0 and 1000.`);
        continue;
      }
      if (component.type === "timer") {
        validateExactKeys2(component, ["id", "type", "enabled", "durationTicks", "repeat"], `${object.id} Timer`);
        if (typeof component.enabled !== "boolean") throw new Error(`Scene object ${object.id} Timer enabled state must be a boolean.`);
        if (!Number.isInteger(component.durationTicks) || component.durationTicks < 1 || component.durationTicks > MAX_TIMER_DURATION_TICKS) {
          throw new Error(`Scene object ${object.id} Timer duration must be between 1 and ${MAX_TIMER_DURATION_TICKS} fixed ticks.`);
        }
        if (typeof component.repeat !== "boolean") throw new Error(`Scene object ${object.id} Timer repeat state must be a boolean.`);
        continue;
      }
      if (component.type === "box-collider") {
        validateExactKeys2(component, ["id", "type", "enabled", "center", "size", "isTrigger"], `${object.id} Box Collider`);
        if (typeof component.enabled !== "boolean") throw new Error(`Scene object ${object.id} Box Collider enabled state must be a boolean.`);
        validateVector(component.center, `${object.id} Box Collider center`);
        validateVector(component.size, `${object.id} Box Collider size`);
        if (component.size.x <= 0 || component.size.y <= 0 || component.size.z <= 0) throw new Error(`Scene object ${object.id} Box Collider size must be positive on every axis.`);
        if (typeof component.isTrigger !== "boolean") throw new Error(`Scene object ${object.id} Box Collider trigger state must be a boolean.`);
        continue;
      }
      if (component.type === "logic") {
        continue;
      }
      throw new Error(`Scene object ${object.id} contains unsupported component type ${String(component.type)}.`);
    }
  }
  for (const object of scene.objects) {
    if (object.parentId === null) continue;
    if (object.parentId === object.id) throw new Error(`Scene object ${object.id} cannot parent itself.`);
    if (!objectsById.has(object.parentId)) throw new Error(`Scene object ${object.id} references missing parent ${object.parentId}.`);
  }
  for (const object of scene.objects) {
    const ancestry = /* @__PURE__ */ new Set();
    let current = object;
    let depth = 1;
    while (current) {
      if (ancestry.has(current.id)) throw new Error(`Scene object hierarchy contains a cycle at ${current.id}.`);
      ancestry.add(current.id);
      if (depth > MAX_SCENE_DEPTH) {
        throw new Error(`Scene object hierarchy exceeds the maximum depth of ${MAX_SCENE_DEPTH} at ${object.id}.`);
      }
      current = current.parentId === null ? void 0 : objectsById.get(current.parentId);
      depth += 1;
    }
  }
  validateLogicScene(scene);
  if (enabledCameraObjects.length !== 1) throw new Error("Scene must contain exactly one enabled Camera component.");
  const active = objectsById.get(scene.activeCameraId);
  if (!active) throw new Error(`Scene active camera ${scene.activeCameraId} does not reference an exact scene object id.`);
  const activeComponent = cameraComponent(active);
  if (!activeComponent) throw new Error(`Scene active camera ${scene.activeCameraId} is missing its Camera component.`);
  if (!activeComponent.enabled || enabledCameraObjects[0].id !== active.id) throw new Error(`Scene active camera ${scene.activeCameraId} must be the enabled Camera component.`);
  let activeBranch = active;
  while (activeBranch) {
    if (!activeBranch.visible) throw new Error(`Scene active camera ${scene.activeCameraId} must be effectively visible.`);
    activeBranch = activeBranch.parentId === null ? void 0 : objectsById.get(activeBranch.parentId);
  }
}
function validateExactKeys2(value, allowed, label) {
  const allowedKeys = new Set(allowed);
  const extra = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (extra) throw new Error(`${label} contains unsupported field ${extra}.`);
}
function validateSceneMaterial(material, label, assetsById) {
  if (!material || typeof material !== "object") throw new Error(`${label} is missing.`);
  if (material.kind === "inline") {
    validateInlineMaterial(material, label, assetsById);
    return;
  }
  if (material.kind !== "embedded") throw new Error(`${label} has unsupported material data.`);
  validateExactKeys2(material, ["kind", "overrides"], label);
  if (!Array.isArray(material.overrides) || material.overrides.length > 64) throw new Error(`${label} must contain no more than 64 named overrides.`);
  const slots = /* @__PURE__ */ new Set();
  for (const override of material.overrides) {
    if (!override || typeof override !== "object") throw new Error(`${label} contains an invalid named override.`);
    validateExactKeys2(override, ["slot", "material"], `${label} override`);
    if (typeof override.slot !== "string" || !override.slot.trim() || override.slot.length > 128 || /[\u0000-\u001f\u007f]/.test(override.slot)) {
      throw new Error(`${label} contains an invalid named slot.`);
    }
    const slot = override.slot.toLocaleLowerCase();
    if (slots.has(slot)) throw new Error(`${label} contains duplicate named slot ${override.slot}.`);
    slots.add(slot);
    if (override.material?.kind !== "inline") throw new Error(`${label} override ${override.slot} must use an inline material.`);
    validateInlineMaterial(override.material, `${label} override ${override.slot}`, assetsById);
  }
}
function validateInlineMaterial(material, label, assetsById) {
  validateExactKeys2(material, ["kind", "shading", "baseColor", "baseColorTextureAssetId", "roughness", "metalness", "opacity", "alphaMode", "alphaCutoff", "doubleSided"], label);
  if (material.shading !== "lit" && material.shading !== "unlit") throw new Error(`${label} shading must be lit or unlit.`);
  validateColor(material.baseColor, `${label} base color`);
  if (material.baseColorTextureAssetId !== null) {
    if (typeof material.baseColorTextureAssetId !== "string" || !SAFE_ID2.test(material.baseColorTextureAssetId)) throw new Error(`${label} has an invalid texture asset id.`);
    if (assetsById.get(material.baseColorTextureAssetId)?.type !== "image") throw new Error(`${label} references a missing image asset.`);
  }
  if (!isFiniteInRange(material.roughness, 0, 1)) throw new Error(`${label} roughness must be between 0 and 1.`);
  if (!isFiniteInRange(material.metalness, 0, 1)) throw new Error(`${label} metalness must be between 0 and 1.`);
  if (!isFiniteInRange(material.opacity, 0, 1)) throw new Error(`${label} opacity must be between 0 and 1.`);
  if (material.alphaMode !== "opaque" && material.alphaMode !== "mask" && material.alphaMode !== "blend") throw new Error(`${label} alpha mode must be opaque, mask, or blend.`);
  if (!isFiniteInRange(material.alphaCutoff, 0, 1)) throw new Error(`${label} alpha cutoff must be between 0 and 1.`);
  if (typeof material.doubleSided !== "boolean") throw new Error(`${label} double-sided state must be a boolean.`);
}
function validateVector(value, label) {
  if (!value || ![value.x, value.y, value.z].every((part) => Number.isFinite(part) && Math.abs(part) <= 1e6)) {
    throw new Error(`${label} must contain finite x, y, and z values.`);
  }
  validateExactKeys2(value, ["x", "y", "z"], label);
}
function validateColor(value, label) {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) throw new Error(`${label} must be a six-digit hex color.`);
}
function isFiniteInRange(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

// src/runtimeAdapters.ts
var ZEBRA_RUNTIME_ADAPTER = Object.freeze({
  kind: "zebra-runtime",
  label: "Zebra",
  defaultUrl: "http://127.0.0.1:8765/"
});
var ZEBRA_LEGACY_OBJECT_IDS = [
  "main-camera",
  "arena-floor",
  "arena-dirt-ring",
  "arena-performance-ring",
  "arena-chalk-ring",
  "tent",
  "weapon-mc9400",
  "weapon-mc3400",
  "weapon-ps30",
  "weapon-tc8300",
  "qr-mc9400",
  "qr-mc3400",
  "qr-ps30",
  "qr-tc8300",
  "barrel-0",
  "barrel-1",
  "barrel-2",
  "barrel-3",
  "center-plinth",
  "arena-boundary-north",
  "arena-boundary-south",
  "arena-boundary-west",
  "arena-boundary-east"
];
var numberedIds = (prefix, count) => Array.from(
  { length: count },
  (_, index) => `${prefix}-${String(index).padStart(2, "0")}`
);
var ZEBRA_CATEGORY_ROOT_IDS = ["arena-root", "devices-root", "bleachers-root", "decor-root", "bunting-root", "crowd-root", "balloons-root"];
var ZEBRA_LIGHT_IDS = ["arena-ambient-light", "arena-top-light", "arena-rim-east", "arena-rim-west", "arena-rim-north", "arena-rim-south"];
var ZEBRA_BLEACHER_IDS = [
  ...numberedIds("bleacher-seat", 5),
  ...numberedIds("bleacher-riser", 5),
  ...numberedIds("bleacher-strut", 16)
];
var ZEBRA_TRAPEZE_IDS = ["trapeze-bar", "trapeze-rope-left", "trapeze-rope-right"];
var ZEBRA_BUNTING_IDS = numberedIds("bunting", 60);
var ZEBRA_PROCEDURAL_CROWD_IDS = numberedIds("crowd-proc", 40);
var ZEBRA_GLTF_CROWD_IDS = numberedIds("crowd-gltf", 28);
var ZEBRA_BALLOON_IDS = numberedIds("balloon", 28);
var ZEBRA_REQUIRED_OBJECT_IDS = [
  ...ZEBRA_LEGACY_OBJECT_IDS,
  ...ZEBRA_CATEGORY_ROOT_IDS,
  "tent-details",
  ...ZEBRA_LIGHT_IDS,
  ...ZEBRA_BLEACHER_IDS,
  ...ZEBRA_TRAPEZE_IDS,
  ...ZEBRA_BUNTING_IDS,
  ...ZEBRA_PROCEDURAL_CROWD_IDS,
  ...ZEBRA_GLTF_CROWD_IDS,
  ...ZEBRA_BALLOON_IDS
];
var ZEBRA_REQUIRED_OBJECT_ID_SET = new Set(ZEBRA_REQUIRED_OBJECT_IDS);
var ZEBRA_ASSET_IDS = [
  "asset-mc9400",
  "asset-mc3400",
  "asset-ps30",
  "asset-tc8300",
  "asset-tent",
  "asset-arena-circle",
  "asset-dirt-ring",
  "asset-chalk-ring",
  "asset-qr-mc9400",
  "asset-qr-mc3400",
  "asset-qr-ps30",
  "asset-qr-tc8300",
  "asset-barrel",
  "asset-podium",
  "asset-bleacher-seat",
  "asset-bleacher-riser",
  "asset-bunting-flag",
  ...numberedIds("asset-crowd-seated", 40),
  "asset-crowd-char1",
  "asset-crowd-char2",
  "asset-crowd-char4",
  "asset-crowd-char6",
  "asset-crowd-man",
  "asset-crowd-worker",
  "asset-tent-details",
  "asset-balloon-red",
  "asset-balloon-blue",
  "asset-balloon-yellow",
  "asset-balloon-green",
  "asset-balloon-magenta",
  "asset-balloon-orange",
  "asset-balloon-cyan",
  "asset-balloon-pink"
];
var ZEBRA_LEGACY_ASSET_IDS = [
  "asset-mc9400",
  "asset-mc3400",
  "asset-ps30",
  "asset-tc8300",
  "asset-tent",
  "asset-arena-circle",
  "asset-dirt-ring",
  "asset-chalk-ring",
  "asset-qr-board",
  "asset-barrel",
  "asset-podium",
  "asset-bleacher-seat",
  "asset-bleacher-riser",
  "asset-bunting-flag",
  "asset-crowd-proxy",
  "asset-tent-details",
  "asset-balloon-red",
  "asset-balloon-blue",
  "asset-balloon-yellow",
  "asset-balloon-green",
  "asset-balloon-magenta",
  "asset-balloon-orange",
  "asset-balloon-cyan",
  "asset-balloon-pink"
];
function isZebraRuntimeOwnedObjectId(id) {
  return ZEBRA_REQUIRED_OBJECT_ID_SET.has(id);
}
function isSupportedZebraExtraObject(object) {
  return object.components.every((component) => {
    if (component.type === "box-collider") return true;
    return component.type === "mesh-renderer" && component.source.kind === "primitive" && component.material.kind === "inline" && component.material.baseColorTextureAssetId === null;
  });
}
function runtimeAdapterForScene(scene) {
  if (scene.schema !== "game-port-studio/scene@0.14" || scene.activeCameraId !== "main-camera") return null;
  const objectIds = new Set(scene.objects.map((object) => object.id));
  const assetIds = new Set(scene.assets.map((asset) => asset.id));
  if (!ZEBRA_REQUIRED_OBJECT_IDS.every((id) => objectIds.has(id))) return null;
  if (!scene.objects.filter((object) => !ZEBRA_REQUIRED_OBJECT_ID_SET.has(object.id)).every(isSupportedZebraExtraObject)) return null;
  const exactVisualAssets = ZEBRA_ASSET_IDS.every((id) => assetIds.has(id));
  const legacyVisualAssets = ZEBRA_LEGACY_ASSET_IDS.every((id) => assetIds.has(id));
  if (!exactVisualAssets && !legacyVisualAssets) return null;
  const parentById = new Map(scene.objects.map((object) => [object.id, object.parentId]));
  const hasDirectParent = (ids, parentId) => ids.every((id) => parentById.get(id) === parentId);
  if (!hasDirectParent(ZEBRA_BLEACHER_IDS, "bleachers-root")) return null;
  if (!hasDirectParent(ZEBRA_BUNTING_IDS, "bunting-root")) return null;
  if (!hasDirectParent([...ZEBRA_PROCEDURAL_CROWD_IDS, ...ZEBRA_GLTF_CROWD_IDS], "crowd-root")) return null;
  if (!hasDirectParent(ZEBRA_BALLOON_IDS, "balloons-root")) return null;
  if (!hasDirectParent(ZEBRA_TRAPEZE_IDS, "decor-root")) return null;
  if (!hasDirectParent([...ZEBRA_LIGHT_IDS, "tent-details"], "arena-root")) return null;
  const assetForObject = (id) => {
    const object = scene.objects.find((candidate) => candidate.id === id);
    const renderer = object ? meshRendererComponent(object) : null;
    return renderer?.source.kind === "asset" ? renderer.source.assetId : null;
  };
  if (exactVisualAssets) {
    const qrAssets = /* @__PURE__ */ new Set(["asset-qr-mc9400", "asset-qr-mc3400", "asset-qr-ps30", "asset-qr-tc8300"]);
    const qrIds = ["qr-mc9400", "qr-mc3400", "qr-ps30", "qr-tc8300"];
    const seatedAssets = new Set(numberedIds("asset-crowd-seated", 40));
    const importedCrowdAssets = /* @__PURE__ */ new Set(["asset-crowd-char1", "asset-crowd-char2", "asset-crowd-char4", "asset-crowd-char6", "asset-crowd-man", "asset-crowd-worker"]);
    if (!qrIds.every((id) => qrAssets.has(assetForObject(id) ?? ""))) return null;
    if (!ZEBRA_PROCEDURAL_CROWD_IDS.every((id) => seatedAssets.has(assetForObject(id) ?? ""))) return null;
    if (!ZEBRA_GLTF_CROWD_IDS.every((id) => importedCrowdAssets.has(assetForObject(id) ?? ""))) return null;
  }
  return ZEBRA_RUNTIME_ADAPTER;
}

// src/zebraCollaborationContract.ts
var ZebraCollaborationContractError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ZebraCollaborationContractError";
  }
};
var QR_ASSET_IDS = /* @__PURE__ */ new Set(["asset-qr-mc9400", "asset-qr-mc3400", "asset-qr-ps30", "asset-qr-tc8300"]);
function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function compactSceneDocument(scene) {
  const assets = scene.assets.map(({ source: _source, ...asset }) => ({ ...asset }));
  return structuredClone({ ...scene, assets });
}
function hydrateSceneDocument(compact, seed) {
  const seedAssets = compactSceneDocument(seed).assets;
  if (!jsonEqual(compact.assets, seedAssets)) {
    throw new ZebraCollaborationContractError("asset_pack_changed", "Zebra's immutable hosted asset pack cannot be changed.");
  }
  return structuredClone({ ...compact, assets: seed.assets });
}
function assertZebraCollaboratorMutationAllowed(baseline2, candidate) {
  const baselineEnvelope = { ...baseline2, objects: [] };
  const candidateEnvelope = { ...candidate, objects: [] };
  if (!jsonEqual(baselineEnvelope, candidateEnvelope)) {
    throw new ZebraCollaborationContractError(
      "project_data_locked",
      "The focused editor cannot change Zebra's project settings, input/logic data, active camera, background, or embedded asset pack."
    );
  }
  const candidateById = new Map(candidate.objects.map((object) => [object.id, object]));
  for (const original of baseline2.objects.filter((object) => isZebraRuntimeOwnedObjectId(object.id))) {
    const edited = candidateById.get(original.id);
    if (!edited) throw new ZebraCollaborationContractError("fixed_object_missing", `The required Zebra object ${original.id} is missing.`);
    if (edited.parentId !== original.parentId) throw new ZebraCollaborationContractError("fixed_parent_changed", `The required Zebra object ${original.id} cannot change parent.`);
    const originalComponents = new Map(original.components.map((component) => [component.type, component]));
    const editedComponents = new Map(edited.components.map((component) => [component.type, component]));
    for (const [type, component] of originalComponents) {
      if (type === "box-collider") continue;
      const next = editedComponents.get(type);
      if (!next) throw new ZebraCollaborationContractError("fixed_component_missing", `${original.id} cannot remove its ${type} component.`);
      if (component.id !== next.id) throw new ZebraCollaborationContractError("fixed_component_identity", `${original.id} cannot replace its ${type} component identity.`);
      if (component.type === "mesh-renderer") {
        if (next.type !== "mesh-renderer") throw new ZebraCollaborationContractError("fixed_mesh_changed", `${original.id} has an invalid Mesh Renderer.`);
        if (original.id.startsWith("qr-")) {
          if (next.source.kind !== "asset" || !QR_ASSET_IDS.has(next.source.assetId)) {
            throw new ZebraCollaborationContractError("invalid_qr_artwork", `${original.id} must use one of Zebra's four exact QR artworks.`);
          }
        } else if (!jsonEqual(component.source, next.source)) {
          throw new ZebraCollaborationContractError("fixed_mesh_source", `${original.id} cannot change its original mesh source.`);
        }
        continue;
      }
      if (component.type === "camera" || component.type === "directional-light") continue;
      if (!jsonEqual(component, next)) {
        throw new ZebraCollaborationContractError("runtime_component_locked", `${original.id} cannot change its ${type} runtime component in the focused editor.`);
      }
    }
    for (const [type] of editedComponents) {
      if (type !== "box-collider" && !originalComponents.has(type)) {
        throw new ZebraCollaborationContractError("unsupported_fixed_component", `${original.id} can only add a Box Collider in the focused editor.`);
      }
    }
  }
}
function validateHostedZebraScene(compact, seed) {
  const candidate = hydrateSceneDocument(compact, seed);
  try {
    validateScene(candidate);
  } catch (cause) {
    throw new ZebraCollaborationContractError("invalid_scene", cause instanceof Error ? cause.message : "The Zebra scene failed schema validation.");
  }
  if (runtimeAdapterForScene(candidate)?.kind !== "zebra-runtime") {
    throw new ZebraCollaborationContractError("not_zebra_scene", "The scene no longer matches Zebra's fixed runtime inventory and supported editable extras.");
  }
  assertZebraCollaboratorMutationAllowed(seed, candidate);
  return candidate;
}

// cloud/zebraSyncValidator.ts
var [, , baselinePath, claimPath, outputPath] = process.argv;
if (!baselinePath || !claimPath || !outputPath) {
  throw new Error("Usage: zebra-scene-sync-validator <baseline-scene> <claim-json> <output-scene>");
}
var baseline = parseJson(await readFile(baselinePath, "utf8"), "baseline Zebra scene");
var claim = parseJson(await readFile(claimPath, "utf8"), "Cloudflare sync claim");
assertClaimEnvelope(claim);
validateScene(baseline);
var compactSha = createHash("sha256").update(JSON.stringify(claim.compact)).digest("hex");
if (compactSha !== claim.compactSha256) {
  throw new Error(`The compact scene hash ${compactSha} does not match the hosted receipt.`);
}
var validated = validateHostedZebraScene(claim.compact, baseline);
var output = `${JSON.stringify(validated, null, 2)}
`;
var outputSha = createHash("sha256").update(output).digest("hex");
await writeFile(outputPath, output, { encoding: "utf8", flag: "wx" });
process.stdout.write(JSON.stringify({ requestId: claim.requestId, revision: claim.revision, compactSha256: compactSha, sceneSha256: outputSha }));
function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`The ${label} is not valid JSON.`);
  }
}
function assertClaimEnvelope(claim2) {
  if (!claim2 || claim2.pending !== true || typeof claim2.compact !== "object") throw new Error("The hosted response is not a pending Zebra scene claim.");
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  if (!uuid.test(claim2.requestId) || !uuid.test(claim2.leaseId)) throw new Error("The hosted claim has an invalid request identity.");
  if (!Number.isSafeInteger(claim2.revision) || claim2.revision < 1) throw new Error("The hosted claim has an invalid revision.");
  if (!/^[0-9a-f]{40}$/i.test(claim2.expectedGitHead)) throw new Error("The hosted claim has an invalid expected Git head.");
  if (!/^[0-9a-f]{64}$/i.test(claim2.compactSha256)) throw new Error("The hosted claim has an invalid compact scene digest.");
  if (claim2.repository !== "Sparkah/zebra-circus-game" || claim2.branch !== "agent/game-port-studio-integration" || claim2.path !== "zebra-circus.scene.json") {
    throw new Error("The hosted claim targets a repository location outside the Zebra review branch.");
  }
}
