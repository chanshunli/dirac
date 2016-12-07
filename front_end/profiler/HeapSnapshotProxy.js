/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyrightdd
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
Profiler.HeapSnapshotWorkerProxy = class extends Common.Object {
  /**
   * @param {function(string, *)} eventHandler
   */
  constructor(eventHandler) {
    super();
    this._eventHandler = eventHandler;
    this._nextObjectId = 1;
    this._nextCallId = 1;
    /** @type {!Map<number, function(*)>} */
    this._callbacks = new Map();
    /** @type {!Set<number>} */
    this._previousCallbacks = new Set();
    this._worker = new Common.Worker('heap_snapshot_worker');
    this._worker.onmessage = this._messageReceived.bind(this);
  }

  /**
   * @param {number} profileUid
   * @param {function(!Profiler.HeapSnapshotProxy)} snapshotReceivedCallback
   * @return {!Profiler.HeapSnapshotLoaderProxy}
   */
  createLoader(profileUid, snapshotReceivedCallback) {
    var objectId = this._nextObjectId++;
    var proxy = new Profiler.HeapSnapshotLoaderProxy(this, objectId, profileUid, snapshotReceivedCallback);
    this._postMessage({
      callId: this._nextCallId++,
      disposition: 'create',
      objectId: objectId,
      methodName: 'HeapSnapshotWorker.HeapSnapshotLoader'
    });
    return proxy;
  }

  dispose() {
    this._worker.terminate();
    if (this._interval)
      clearInterval(this._interval);
  }

  disposeObject(objectId) {
    this._postMessage({callId: this._nextCallId++, disposition: 'dispose', objectId: objectId});
  }

  evaluateForTest(script, callback) {
    var callId = this._nextCallId++;
    this._callbacks.set(callId, callback);
    this._postMessage({callId: callId, disposition: 'evaluateForTest', source: script});
  }

  /**
   * @param {?function(...?)} callback
   * @param {string} objectId
   * @param {string} methodName
   * @param {function(new:T, ...?)} proxyConstructor
   * @return {?Object}
   * @template T
   */
  callFactoryMethod(callback, objectId, methodName, proxyConstructor) {
    var callId = this._nextCallId++;
    var methodArguments = Array.prototype.slice.call(arguments, 4);
    var newObjectId = this._nextObjectId++;

    /**
     * @this {Profiler.HeapSnapshotWorkerProxy}
     */
    function wrapCallback(remoteResult) {
      callback(remoteResult ? new proxyConstructor(this, newObjectId) : null);
    }

    if (callback) {
      this._callbacks.set(callId, wrapCallback.bind(this));
      this._postMessage({
        callId: callId,
        disposition: 'factory',
        objectId: objectId,
        methodName: methodName,
        methodArguments: methodArguments,
        newObjectId: newObjectId
      });
      return null;
    } else {
      this._postMessage({
        callId: callId,
        disposition: 'factory',
        objectId: objectId,
        methodName: methodName,
        methodArguments: methodArguments,
        newObjectId: newObjectId
      });
      return new proxyConstructor(this, newObjectId);
    }
  }

  /**
   * @param {function(*)} callback
   * @param {string} objectId
   * @param {string} methodName
   */
  callMethod(callback, objectId, methodName) {
    var callId = this._nextCallId++;
    var methodArguments = Array.prototype.slice.call(arguments, 3);
    if (callback)
      this._callbacks.set(callId, callback);
    this._postMessage({
      callId: callId,
      disposition: 'method',
      objectId: objectId,
      methodName: methodName,
      methodArguments: methodArguments
    });
  }

  startCheckingForLongRunningCalls() {
    if (this._interval)
      return;
    this._checkLongRunningCalls();
    this._interval = setInterval(this._checkLongRunningCalls.bind(this), 300);
  }

  _checkLongRunningCalls() {
    for (var callId of this._previousCallbacks) {
      if (!this._callbacks.has(callId))
        this._previousCallbacks.delete(callId);
    }
    var hasLongRunningCalls = !!this._previousCallbacks.size;
    this.dispatchEventToListeners(Profiler.HeapSnapshotWorkerProxy.Events.Wait, hasLongRunningCalls);
    for (var callId of this._callbacks.keysArray())
      this._previousCallbacks.add(callId);
  }

  /**
   * @param {!MessageEvent} event
   */
  _messageReceived(event) {
    var data = event.data;
    if (data.eventName) {
      if (this._eventHandler)
        this._eventHandler(data.eventName, data.data);
      return;
    }
    if (data.error) {
      if (data.errorMethodName) {
        Common.console.error(
            Common.UIString('An error occurred when a call to method \'%s\' was requested', data.errorMethodName));
      }
      Common.console.error(data['errorCallStack']);
      this._callbacks.delete(data.callId);
      return;
    }
    if (!this._callbacks.has(data.callId))
      return;
    var callback = this._callbacks.get(data.callId);
    this._callbacks.delete(data.callId);
    callback(data.result);
  }

  _postMessage(message) {
    this._worker.postMessage(message);
  }
};

Profiler.HeapSnapshotWorkerProxy.Events = {
  Wait: Symbol('Wait')
};

/**
 * @unrestricted
 */
Profiler.HeapSnapshotProxyObject = class {
  /**
   * @param {!Profiler.HeapSnapshotWorkerProxy} worker
   * @param {number} objectId
   */
  constructor(worker, objectId) {
    this._worker = worker;
    this._objectId = objectId;
  }

  /**
   * @param {string} workerMethodName
   * @param {!Array.<*>} args
   */
  _callWorker(workerMethodName, args) {
    args.splice(1, 0, this._objectId);
    return this._worker[workerMethodName].apply(this._worker, args);
  }

  dispose() {
    this._worker.disposeObject(this._objectId);
  }

  disposeWorker() {
    this._worker.dispose();
  }

  /**
   * @param {?function(...?)} callback
   * @param {string} methodName
   * @param {function (new:T, ...?)} proxyConstructor
   * @param {...*} var_args
   * @return {!T}
   * @template T
   */
  callFactoryMethod(callback, methodName, proxyConstructor, var_args) {
    return this._callWorker('callFactoryMethod', Array.prototype.slice.call(arguments, 0));
  }

  /**
   * @param {function(T)|undefined} callback
   * @param {string} methodName
   * @param {...*} var_args
   * @return {*}
   * @template T
   */
  callMethod(callback, methodName, var_args) {
    return this._callWorker('callMethod', Array.prototype.slice.call(arguments, 0));
  }

  /**
   * @param {string} methodName
   * @param {...*} var_args
   * @return {!Promise.<?T>}
   * @template T
   */
  _callMethodPromise(methodName, var_args) {
    /**
     * @param {!Array.<*>} args
     * @param {function(?T)} fulfill
     * @this {Profiler.HeapSnapshotProxyObject}
     * @template T
     */
    function action(args, fulfill) {
      this._callWorker('callMethod', [fulfill].concat(args));
    }
    return new Promise(action.bind(this, Array.prototype.slice.call(arguments)));
  }
};

/**
 * @implements {Common.OutputStream}
 * @unrestricted
 */
Profiler.HeapSnapshotLoaderProxy = class extends Profiler.HeapSnapshotProxyObject {
  /**
   * @param {!Profiler.HeapSnapshotWorkerProxy} worker
   * @param {number} objectId
   * @param {number} profileUid
   * @param {function(!Profiler.HeapSnapshotProxy)} snapshotReceivedCallback
   */
  constructor(worker, objectId, profileUid, snapshotReceivedCallback) {
    super(worker, objectId);
    this._profileUid = profileUid;
    this._snapshotReceivedCallback = snapshotReceivedCallback;
  }

  /**
   * @override
   * @param {string} chunk
   * @param {function(!Common.OutputStream)=} callback
   */
  write(chunk, callback) {
    this.callMethod(callback, 'write', chunk);
  }

  /**
   * @override
   * @param {function()=} callback
   */
  close(callback) {
    /**
     * @this {Profiler.HeapSnapshotLoaderProxy}
     */
    function buildSnapshot() {
      if (callback)
        callback();
      this.callFactoryMethod(updateStaticData.bind(this), 'buildSnapshot', Profiler.HeapSnapshotProxy);
    }

    /**
     * @param {!Profiler.HeapSnapshotProxy} snapshotProxy
     * @this {Profiler.HeapSnapshotLoaderProxy}
     */
    function updateStaticData(snapshotProxy) {
      this.dispose();
      snapshotProxy.setProfileUid(this._profileUid);
      snapshotProxy.updateStaticData(this._snapshotReceivedCallback.bind(this));
    }

    this.callMethod(buildSnapshot.bind(this), 'close');
  }
};

/**
 * @unrestricted
 */
Profiler.HeapSnapshotProxy = class extends Profiler.HeapSnapshotProxyObject {
  /**
   * @param {!Profiler.HeapSnapshotWorkerProxy} worker
   * @param {number} objectId
   */
  constructor(worker, objectId) {
    super(worker, objectId);
    /** @type {?Profiler.HeapSnapshotCommon.StaticData} */
    this._staticData = null;
  }

  /**
   * @param {!Profiler.HeapSnapshotCommon.SearchConfig} searchConfig
   * @param {!Profiler.HeapSnapshotCommon.NodeFilter} filter
   * @return {!Promise<!Array<number>>}
   */
  search(searchConfig, filter) {
    return this._callMethodPromise('search', searchConfig, filter);
  }

  /**
   * @param {!Profiler.HeapSnapshotCommon.NodeFilter} filter
   * @param {function(!Object.<string, !Profiler.HeapSnapshotCommon.Aggregate>)} callback
   */
  aggregatesWithFilter(filter, callback) {
    this.callMethod(callback, 'aggregatesWithFilter', filter);
  }

  aggregatesForDiff(callback) {
    this.callMethod(callback, 'aggregatesForDiff');
  }

  calculateSnapshotDiff(baseSnapshotId, baseSnapshotAggregates, callback) {
    this.callMethod(callback, 'calculateSnapshotDiff', baseSnapshotId, baseSnapshotAggregates);
  }

  /**
   * @param {number} snapshotObjectId
   * @return {!Promise<?string>}
   */
  nodeClassName(snapshotObjectId) {
    return this._callMethodPromise('nodeClassName', snapshotObjectId);
  }

  /**
   * @param {number} nodeIndex
   * @return {!Profiler.HeapSnapshotProviderProxy}
   */
  createEdgesProvider(nodeIndex) {
    return this.callFactoryMethod(null, 'createEdgesProvider', Profiler.HeapSnapshotProviderProxy, nodeIndex);
  }

  /**
   * @param {number} nodeIndex
   * @return {!Profiler.HeapSnapshotProviderProxy}
   */
  createRetainingEdgesProvider(nodeIndex) {
    return this.callFactoryMethod(null, 'createRetainingEdgesProvider', Profiler.HeapSnapshotProviderProxy, nodeIndex);
  }

  /**
   * @param {string} baseSnapshotId
   * @param {string} className
   * @return {?Profiler.HeapSnapshotProviderProxy}
   */
  createAddedNodesProvider(baseSnapshotId, className) {
    return this.callFactoryMethod(
        null, 'createAddedNodesProvider', Profiler.HeapSnapshotProviderProxy, baseSnapshotId, className);
  }

  /**
   * @param {!Array.<number>} nodeIndexes
   * @return {?Profiler.HeapSnapshotProviderProxy}
   */
  createDeletedNodesProvider(nodeIndexes) {
    return this.callFactoryMethod(null, 'createDeletedNodesProvider', Profiler.HeapSnapshotProviderProxy, nodeIndexes);
  }

  /**
   * @param {function(*):boolean} filter
   * @return {?Profiler.HeapSnapshotProviderProxy}
   */
  createNodesProvider(filter) {
    return this.callFactoryMethod(null, 'createNodesProvider', Profiler.HeapSnapshotProviderProxy, filter);
  }

  /**
   * @param {string} className
   * @param {!Profiler.HeapSnapshotCommon.NodeFilter} nodeFilter
   * @return {?Profiler.HeapSnapshotProviderProxy}
   */
  createNodesProviderForClass(className, nodeFilter) {
    return this.callFactoryMethod(
        null, 'createNodesProviderForClass', Profiler.HeapSnapshotProviderProxy, className, nodeFilter);
  }

  allocationTracesTops(callback) {
    this.callMethod(callback, 'allocationTracesTops');
  }

  /**
   * @param {number} nodeId
   * @param {function(!Profiler.HeapSnapshotCommon.AllocationNodeCallers)} callback
   */
  allocationNodeCallers(nodeId, callback) {
    this.callMethod(callback, 'allocationNodeCallers', nodeId);
  }

  /**
   * @param {number} nodeIndex
   * @param {function(?Array.<!Profiler.HeapSnapshotCommon.AllocationStackFrame>)} callback
   */
  allocationStack(nodeIndex, callback) {
    this.callMethod(callback, 'allocationStack', nodeIndex);
  }

  /**
   * @override
   */
  dispose() {
    throw new Error('Should never be called');
  }

  get nodeCount() {
    return this._staticData.nodeCount;
  }

  get rootNodeIndex() {
    return this._staticData.rootNodeIndex;
  }

  updateStaticData(callback) {
    /**
     * @param {!Profiler.HeapSnapshotCommon.StaticData} staticData
     * @this {Profiler.HeapSnapshotProxy}
     */
    function dataReceived(staticData) {
      this._staticData = staticData;
      callback(this);
    }
    this.callMethod(dataReceived.bind(this), 'updateStaticData');
  }

  /**
   * @return {!Promise.<!Profiler.HeapSnapshotCommon.Statistics>}
   */
  getStatistics() {
    return this._callMethodPromise('getStatistics');
  }

  /**
   * @return {!Promise.<?Profiler.HeapSnapshotCommon.Samples>}
   */
  getSamples() {
    return this._callMethodPromise('getSamples');
  }

  get totalSize() {
    return this._staticData.totalSize;
  }

  get uid() {
    return this._profileUid;
  }

  setProfileUid(profileUid) {
    this._profileUid = profileUid;
  }

  /**
   * @return {number}
   */
  maxJSObjectId() {
    return this._staticData.maxJSObjectId;
  }
};

/**
 * @implements {Profiler.HeapSnapshotGridNode.ChildrenProvider}
 * @unrestricted
 */
Profiler.HeapSnapshotProviderProxy = class extends Profiler.HeapSnapshotProxyObject {
  /**
   * @param {!Profiler.HeapSnapshotWorkerProxy} worker
   * @param {number} objectId
   */
  constructor(worker, objectId) {
    super(worker, objectId);
  }

  /**
   * @override
   * @param {number} snapshotObjectId
   * @return {!Promise<number>}
   */
  nodePosition(snapshotObjectId) {
    return this._callMethodPromise('nodePosition', snapshotObjectId);
  }

  /**
   * @override
   * @param {function(boolean)} callback
   */
  isEmpty(callback) {
    this.callMethod(callback, 'isEmpty');
  }

  /**
   * @override
   * @param {number} startPosition
   * @param {number} endPosition
   * @param {function(!Profiler.HeapSnapshotCommon.ItemsRange)} callback
   */
  serializeItemsRange(startPosition, endPosition, callback) {
    this.callMethod(callback, 'serializeItemsRange', startPosition, endPosition);
  }

  /**
   * @override
   * @param {!Profiler.HeapSnapshotCommon.ComparatorConfig} comparator
   * @return {!Promise<?>}
   */
  sortAndRewind(comparator) {
    return this._callMethodPromise('sortAndRewind', comparator);
  }
};
