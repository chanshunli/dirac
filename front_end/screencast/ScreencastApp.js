// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @implements {Common.App}
 * @implements {SDK.TargetManager.Observer}
 * @unrestricted
 */
Screencast.ScreencastApp = class {
  constructor() {
    this._enabledSetting = Common.settings.createSetting('screencastEnabled', true);
    this._toggleButton =
        new UI.ToolbarToggle(Common.UIString('Toggle screencast'), 'largeicon-phone');
    this._toggleButton.setToggled(this._enabledSetting.get());
    this._toggleButton.addEventListener('click', this._toggleButtonClicked, this);
    SDK.targetManager.observeTargets(this);
  }

  /**
   * @return {!Screencast.ScreencastApp}
   */
  static _instance() {
    if (!Screencast.ScreencastApp._appInstance)
      Screencast.ScreencastApp._appInstance = new Screencast.ScreencastApp();
    return Screencast.ScreencastApp._appInstance;
  }

  /**
   * @override
   * @param {!Document} document
   */
  presentUI(document) {
    var rootView = new UI.RootView();

    this._rootSplitWidget =
        new UI.SplitWidget(false, true, 'InspectorView.screencastSplitViewState', 300, 300);
    this._rootSplitWidget.setVertical(true);
    this._rootSplitWidget.setSecondIsSidebar(true);
    this._rootSplitWidget.show(rootView.element);
    this._rootSplitWidget.hideMain();

    this._rootSplitWidget.setSidebarWidget(UI.inspectorView);
    rootView.attachToDocument(document);
  }

  /**
   * @override
   * @param {!SDK.Target} target
   */
  targetAdded(target) {
    if (this._target)
      return;
    this._target = target;

    var resourceTreeModel = SDK.ResourceTreeModel.fromTarget(target);
    if (resourceTreeModel) {
      this._screencastView = new Screencast.ScreencastView(target, resourceTreeModel);
      this._rootSplitWidget.setMainWidget(this._screencastView);
      this._screencastView.initialize();
    } else {
      this._toggleButton.setEnabled(false);
    }
    this._onScreencastEnabledChanged();
  }

  /**
   * @override
   * @param {!SDK.Target} target
   */
  targetRemoved(target) {
    if (this._target === target) {
      delete this._target;
      if (!this._screencastView)
        return;
      this._toggleButton.setEnabled(false);
      this._screencastView.detach();
      delete this._screencastView;
      this._onScreencastEnabledChanged();
    }
  }

  _toggleButtonClicked() {
    var enabled = !this._toggleButton.toggled();
    this._enabledSetting.set(enabled);
    this._onScreencastEnabledChanged();
  }

  _onScreencastEnabledChanged() {
    if (!this._rootSplitWidget)
      return;
    var enabled = this._enabledSetting.get() && this._screencastView;
    this._toggleButton.setToggled(enabled);
    if (enabled)
      this._rootSplitWidget.showBoth();
    else
      this._rootSplitWidget.hideMain();
  }
};

/** @type {!Screencast.ScreencastApp} */
Screencast.ScreencastApp._appInstance;


/**
 * @implements {UI.ToolbarItem.Provider}
 * @unrestricted
 */
Screencast.ScreencastApp.ToolbarButtonProvider = class {
  /**
   * @override
   * @return {?UI.ToolbarItem}
   */
  item() {
    return Screencast.ScreencastApp._instance()._toggleButton;
  }
};

/**
 * @implements {Common.AppProvider}
 * @unrestricted
 */
Screencast.ScreencastAppProvider = class {
  /**
   * @override
   * @return {!Common.App}
   */
  createApp() {
    return Screencast.ScreencastApp._instance();
  }
};
