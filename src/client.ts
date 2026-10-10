window.__ModuleLoader__.load({
  id: "dsh-auto-visual",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");
    var h = react.createElement;
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var SettingsForm = primitives.SettingsForm;
    var SettingsSecretField = primitives.SettingsSecretField;
    var SettingsValueField = primitives.SettingsValueField;
    var SettingsFormModel = primitives.SettingsFormModel;
    var settingsNumberField = primitives.settingsNumberField;
    var settingsTextField = primitives.settingsTextField;
    var Button = primitives.Button;

    var inject = ["configForms", "slots", "locale", "remote"];
    // Wire namespace of the connection-check Service this plugin also mounts.
    var CONNECTION_NAMESPACE = "remote.autoVisualConnection";
    // The Host side uses the SRC Remote fallback, so the browser half must
    // mount the matching client face before asking for remote.autoVisualConnection.
    var AUTO_VISUAL_REMOTE = {
      package: "dsh-auto-visual",
      descriptors: [{
        id: "dsh-auto-visual#autoVisualConnection/checkConnection",
        service: "autoVisualConnection",
        namespace: "autoVisualConnection",
        method: "checkConnection",
        invocation: { kind: "direct" },
        parameters: [],
        result: { mode: "src-json" }
      }]
    };
    var NS = "autoVisual";
    var zh = {
      configTitle: "图片生成",
      description: "配置图片素材规划与生成行为。",
      unavailable: "该插件当前未加载，暂时无法配置。",
      readOnly: "当前部署的设置为只读。",
      save: "保存",
      saving: "保存中…",
      saveFailed: "保存失败：请检查字段值；如果刚更新插件，请重启 DSH Host 后刷新页面，确保 Host 已加载新版配置字段。",
      overridden: "已覆盖",
      reset: "恢复默认",
      invalid: "请输入有效值。",
      mode: "运行模式",
      modeHint: "off 关闭；suggest 只规划；auto 允许生成。可选：off / suggest / auto",
      provider: "生成供应商",
      providerHint: "disabled 禁用；mock 为测试图；openai 使用 OpenAI 兼容 Images API。可选：disabled / mock / openai",
      model: "生成模型 ID",
      modelHint: "填写供应商使用的模型 ID，例如 gpt-image-1。mock 仅接受 mock-v1。",
      baseURL: "Images API 地址",
      baseURLHint: "OpenAI 兼容 API 的版本根地址，例如 https://api.openai.com/v1。",
      apiKey: "API Key",
      apiKeyHint: "直接输入密钥，字符隐藏。保存后不回显；留空则保留原有密钥。",
      keyWriteOnly: "尚未保存密钥",
      keySaved: "已保存密钥（不回显）",
      maxAssets: "每会话最大素材数",
      check: "检查连接",
      checking: "检查中…",
      checkHint: "先保存配置，再检查鉴权和模型查询。不会生成图片；查询成功不代表已验证生图权限。",
      checkSaveFirst: "配置尚未保存，请先保存后再检查。",
      CONNECTED: "连接正常，鉴权通过且模型 ID 匹配。图片生成权限尚未验证。",
      MOCK_READY: "本地模拟供应商已就绪，无需联网；不会生成真实图片。",
      INVALID_MODEL: "mock 仅支持 mock-v1，请修改模型或选择真实供应商。",
      DISABLED: "生成供应商已禁用，请先选择供应商并保存。",
      CREDENTIAL_NOT_CONFIGURED: "尚未配置 API Key，请直接输入密钥并保存。",
      AUTH_FAILED: "鉴权失败，请检查已保存的 API Key 和接口权限。",
      MODEL_OR_ENDPOINT_UNAVAILABLE: "模型不存在，或此接口不支持模型查询；无法确认连接。",
      RATE_LIMITED: "接口限流，请稍后重试。",
      HTTP_ERROR: "接口返回错误。",
      INVALID_RESPONSE: "接口未返回有效的模型信息。",
      MODEL_MISMATCH: "接口返回的模型 ID 与配置不一致。",
      INVALID_ENDPOINT: "API 地址无效，请填写 http/https API 根地址。",
      INVALID_CONFIG: "配置无效，请检查并保存。",
      TIMEOUT: "连接检查超时（15 秒）。",
      NETWORK_OR_RESPONSE_ERROR: "网络连接失败或接口响应无法解析。",
      CHECK_UNAVAILABLE: "连接检查服务未就绪：本插件的 Host 半未加载。请确认插件已加载，必要时重启 DSH Host 后刷新页面。",
      CHECK_FAILED: "连接检查调用失败，请稍后重试。",
      maxAssetsHint: "整数 1–100。"
    };
    var en = {
      configTitle: "Image Generation",
      description: "Configure visual asset planning and generation.",
      unavailable: "This plugin is not loaded, so it cannot be configured right now.",
      readOnly: "This deployment stores settings read-only.",
      save: "Save",
      saving: "Saving…",
      saveFailed: "The deployment did not accept these settings. Check the values and try again.",
      overridden: "Overridden",
      reset: "Reset to default",
      invalid: "Enter a valid value.",
      mode: "Run mode",
      modeHint: "off disables it; suggest plans only; auto permits generation. Choose: off / suggest / auto",
      provider: "Provider",
      providerHint: "Choose disabled, mock (test fixtures), or openai (OpenAI-compatible Images API).",
      model: "Image model ID",
      modelHint: "Provider model ID, for example gpt-image-1. Mock accepts only mock-v1.",
      baseURL: "Images API URL",
      baseURLHint: "Versioned API base URL, for example https://api.openai.com/v1.",
      apiKey: "API Key",
      apiKeyHint: "Enter the key directly; characters are hidden. It is never shown after saving, and blank keeps the existing key.",
      keyWriteOnly: "No key saved",
      keySaved: "Key saved (not shown)",
      maxAssets: "Max assets per session",
      check: "Check connection",
      checking: "Checking…",
      checkHint: "Save first, then verify authentication and model metadata. No image is generated; image generation access is not verified.",
      checkSaveFirst: "Save pending changes before checking.",
      CONNECTED: "Connected: authentication and model ID verified. Image generation access is not verified.",
      MOCK_READY: "Local mock provider is ready; no network or real generation.",
      INVALID_MODEL: "Mock accepts only mock-v1. Change the model or provider.",
      DISABLED: "Provider is disabled. Select a provider and save first.",
      CREDENTIAL_NOT_CONFIGURED: "API Key is not configured. Enter a key and save.",
      AUTH_FAILED: "Authentication failed. Check the saved API key and its access permissions.",
      MODEL_OR_ENDPOINT_UNAVAILABLE: "Model not found or model queries unsupported; connection could not be verified.",
      RATE_LIMITED: "Rate limited. Try again later.",
      HTTP_ERROR: "The API returned an error.",
      INVALID_RESPONSE: "Invalid model metadata response.",
      MODEL_MISMATCH: "Returned model ID does not match the configured model.",
      INVALID_ENDPOINT: "Invalid API URL. Use an http/https base URL.",
      INVALID_CONFIG: "Invalid configuration. Check the fields and save.",
      TIMEOUT: "Connection check timed out (15 seconds).",
      NETWORK_OR_RESPONSE_ERROR: "Network failure or unreadable API response.",
      CHECK_UNAVAILABLE: "Connection service is not ready: this plugin's Host half is not loaded. Confirm the plugin is loaded, and restart the DSH Host and refresh if needed.",
      CHECK_FAILED: "The connection check call failed. Try again.",
      maxAssetsHint: "Whole number from 1 to 100."
    };

    function choiceField(field, values) {
      return {
        field: field,
        format: function (value) { return typeof value === "string" ? value : ""; },
        parse: function (text) {
          return values.indexOf(text) >= 0 ? { kind: "set", value: text } : undefined;
        }
      };
    }
    function formLabels(t) {
      return {
        unavailable: t("unavailable"),
        readOnly: t("readOnly"),
        saveFailed: t("saveFailed"),
        save: t("save"),
        saving: t("saving")
      };
    }
    function fieldProps(model, actions, state, t, field, label, hint, id, numeric) {
      var value = state[field];
      return {
        id: id,
        label: label,
        hint: hint,
        text: value.text,
        overridden: value.overridden,
        invalid: value.invalid,
        overriddenLabel: t("overridden"),
        resetLabel: t("reset"),
        invalidLabel: t("invalid"),
        disabled: !state.writable,
        numeric: numeric,
        onEdit: function (text) { actions.edit(field, text); },
        onReset: function () { actions.resetField(field); }
      };
    }
    function AutoVisualConfigPanel(props) {
      var state = react.useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
      var actions = props.model.actions();
      var t = props.t;
      var checkingState = react.useState(false);
      var resultState = react.useState(null);
      var checking = checkingState[0];
      var setChecking = checkingState[1];
      var result = resultState[0];
      var setResult = resultState[1];
      react.useEffect(function () { setResult(null); }, [state.model && state.model.text, state.provider && state.provider.text, state.baseURL && state.baseURL.text, state.apiKey && state.apiKey.text, state.dirty]);
      async function check() {
        if (checking || state.dirty || state.saving) return;
        setChecking(true);
        setResult(null);
        try {
          // The namespace Service is mounted by ctx.remote.$mount as a sibling
          // fiber, so it must be read lazily through the inject-free accessor
          // rather than as ctx.remote.autoVisualConnection.
          var service = props.connection;
          if (!service || typeof service.checkConnection !== "function") { setResult({ ok: false, code: "CHECK_UNAVAILABLE" }); return; }
          var response = await service.checkConnection();
          if (response.ok) setResult(response.value);
          else setResult({ ok: false, code: "CHECK_FAILED", detail: response.error && response.error.code });
        } catch (_) { setResult({ ok: false, code: "CHECK_FAILED" }); }
        finally { setChecking(false); }
      }
      if (!state.available) return h("div", null, t("unavailable"));
      return h(SettingsForm, {
        labels: formLabels(t),
        state: state,
        onSave: actions.save,
        onDiscard: actions.discard
      },
        h(SettingsValueField, fieldProps(props.model, actions, state, t, "mode", t("mode"), t("modeHint"), "auto-visual-mode", false)),
        h(SettingsValueField, fieldProps(props.model, actions, state, t, "provider", t("provider"), t("providerHint"), "auto-visual-provider", false)),
        h(SettingsValueField, fieldProps(props.model, actions, state, t, "model", t("model"), t("modelHint"), "auto-visual-model", false)),
        h(SettingsValueField, fieldProps(props.model, actions, state, t, "baseURL", t("baseURL"), t("baseURLHint"), "auto-visual-base-url", false)),
        h(SettingsSecretField, {
          id: "auto-visual-api-key",
          label: t("apiKey"),
          hint: t("apiKeyHint"),
          text: state.apiKey.text,
          configured: state.secretConfigured === true,
          stateLabel: state.secretConfigured === true ? t("keySaved") : t("keyWriteOnly"),
          disabled: !state.writable,
          onEdit: function (text) { actions.edit("apiKey", text); }
        }),
        h(SettingsValueField, fieldProps(props.model, actions, state, t, "maxAssets", t("maxAssets"), t("maxAssetsHint"), "auto-visual-max-assets", true)),
        h("div", { className: "flex flex-col gap-2" },
          h(Button, { type: "button", variant: "outline", disabled: checking || state.dirty || state.saving, onClick: check }, checking ? t("checking") : t("check")),
          h("p", { className: "text-sm text-muted" }, state.dirty ? t("checkSaveFirst") : t("checkHint")),
          result ? h("p", { role: "status", "aria-live": "polite", className: "text-sm" }, t(result.code), result.status ? " (HTTP " + result.status + ")" : result.detail ? " (" + result.detail + ")" : "") : null
        )
      );
    }
    async function apply(ctx) {
      var disposeRemote = await ctx.remote.$mount(AUTO_VISUAL_REMOTE);
      var ui;
      try {
        // The mounted namespace Service lands in a sibling fiber, and Cordis
        // serves ctx.remote.<namespace> only to a plugin that declared that exact
        // name as a dependency. This plugin mounts its own namespace, so the name
        // is declared *after* mounting instead of in the static inject list, which
        // would park the plugin waiting on itself.
        ui = ctx.inject([CONNECTION_NAMESPACE, "configForms", "slots", "locale"], registerSection);
        await ui;
      } catch (error) {
        if (ui) await ui.dispose();
        await disposeRemote();
        throw error;
      }
      return async function () { await ui.dispose(); await disposeRemote(); };
    }
    function registerSection(ctx) {
      var t = ctx.locale.bind(NS);
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "auto-visual: dictionaries");
      var scope = ctx.configForms.get("auto-visual");
      var connection = ctx.remote.autoVisualConnection;
      var secretConfigured = false;
      // The settings descriptor is the only surface that reports which
      // role('secret') slots the Host holds a value for; the value itself never
      // crosses a response. Read it lazily so a deployment without the settings
      // namespace only loses the badge, not the page.
      function settingsRemote() {
        try { return ctx.reflect.get("remote.settings", false) || null; } catch (_) { return null; }
      }
      function refreshSecret() {
        var remote = settingsRemote();
        if (!remote || typeof remote.describe !== "function") return Promise.resolve();
        return Promise.resolve(remote.describe()).then(function (response) {
          var next = false;
          if (response && response.ok && Array.isArray(response.value)) {
            var row = response.value.find(function (item) { return item && item.ns === "auto-visual"; });
            var slot = row && row.secrets && row.secrets.find(function (secret) { return secret.path.length === 1 && secret.path[0] === "apiKey"; });
            next = !!(slot && slot.set);
          }
          if (next === secretConfigured) return;
          secretConfigured = next;
          store.set(projection());
        }, function () {});
      }
      // SettingsFormModel fences a draft to the revision captured when editing
      // starts. Plugin/config HMR can advance that revision while the user is
      // typing; after one conflict the model otherwise keeps retrying the stale
      // revision forever. These are scalar path operations, so resolve the
      // revision at write time through ConfigForm instead. Unrelated fields are
      // preserved by the Host mutation and no DSH implementation patch is needed.
      var liveRevisionScope = {
        getSnapshot: function () { return scope.getSnapshot(); },
        subscribe: function (listener) { return scope.subscribe(listener); },
        mutate: function (ops) { return scope.mutate(ops); }
      };
      var model = new SettingsFormModel(liveRevisionScope, [
        choiceField("mode", ["off", "suggest", "auto"]),
        choiceField("provider", ["disabled", "mock", "openai"]),
        settingsTextField("model"),
        settingsTextField("baseURL"),
        settingsNumberField("maxAssets")
      ], [{
        field: "apiKey",
        write: function (text) {
          // Empty secret drafts never clear or overwrite a stored credential.
          if (!text.trim()) return Promise.resolve(true);
          return scope.mutate([{ op: "set", path: ["apiKey"], value: text.trim() }]).then(function (accepted) {
            return accepted ? refreshSecret().then(function () { return true; }) : accepted;
          });
        }
      }]);
      function projection() {
        return Object.assign({}, model.shell(), {
          mode: model.field("mode"),
          provider: model.field("provider"),
          model: model.field("model"),
          baseURL: model.field("baseURL"),
          apiKey: model.field("apiKey"),
          maxAssets: model.field("maxAssets"),
          secretConfigured: secretConfigured
        });
      }
      var store = model.bind(projection);
      ctx.effect(function () { return function () { model.dispose(); }; }, "auto-visual: form subscription");
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "auto-visual",
          order: 150,
          label: function () { return t("configTitle"); },
          locale: NS,
          inject: function () { return { model: model, store: store, t: t, connection: connection }; }
        }, AutoVisualConfigPanel);
      });
      refreshSecret();
    }
    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
