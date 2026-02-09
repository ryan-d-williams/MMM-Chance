const DEFAULT_BUTTONS = Object.freeze([
	{ id: "coin", label: "Flip Coin", mode: "coin" },
	{ id: "d6", label: "Roll d6", mode: "dice", sides: 6 },
	{ id: "d10", label: "Roll d10", mode: "dice", sides: 10 },
	{ id: "d100", label: "Roll d100", mode: "dice", sides: 100 }
]);


Module.register("MMM-Chance", {
	requiresVersion: "2.2.0",

	defaults: {
		animationDurationMs: 1200,
		animationFrameMs: 90,
		autoResetMs: null,
		compact: false,
		flatCoin: true,
		notification: null,
		buttons: DEFAULT_BUTTONS
	},

	start: function () {
		Log.info("Starting module: " + this.name);

		this.domId = `${this.identifier}-root`;
		this.spriteUrl = this.file("assets/sprite.svg");

		this.config.animationDurationMs = toBoundedInt(this.config.animationDurationMs, 200, 15000, 1200);
		this.config.animationFrameMs = toBoundedInt(this.config.animationFrameMs, 40, 1000, 90);
		this.config.autoResetMs = toOptionalBoundedInt(this.config.autoResetMs, 200, 3600000);

		this.actions = normalizeButtons(this.config.buttons);
		this.actionById = new Map(this.actions.map((action) => [action.id, action]));
		this.actionByNotify = new Map(
			this.actions
				.filter((action) => action.notify)
				.map((action) => [action.notify, action])
		);

		this.state = {
			view: "buttons",  // "buttons" or "result"
			isAnimating: false,
			mode: "coin",
			symbolId: "coin-heads",
			overlayText: ""
		};

		this.frameInterval = null;
		this.endTimeout = null;
		this.autoResetTimeout = null;

		this.boundRoot = null;
		this.onRootClick = this.onRootClick.bind(this);
	},

	getStyles: function () {
		return [this.file("MMM-Chance.css")];
	},

	getScripts: function () {
		return [];
	},

	getTemplate: function () {
		return "mmm-chance.njk";
	},

	getTemplateData: function () {
		const isResult = this.state.view === "result";

		return {
			view: {
				domId: this.domId,
				compact: Boolean(this.config.compact),
				flatCoin: Boolean(this.config.flatCoin),
				buttons: this.actions.map((action) => ({
					id: action.id,
					label: action.label,
					className: action.className
				})),
				token: {
					mode: this.state.mode,
					symbolId: this.state.symbolId,
					overlayText: this.state.overlayText,
					isAnimating: this.state.isAnimating,
					spriteUrl: this.spriteUrl,
					ariaLabel: this.state.mode === "coin" ? "Coin" : "Die"
				},
				isResult
			}
		};
	},

	notificationReceived: function (notification, payload) {
		if (notification === "DOM_OBJECTS_CREATED") {
			this.bindUiEvents();
			this.syncView();
			return;
		}

		if (!this.config.notification || notification !== this.config.notification) {
			return;
		};

		const target = parseNotificationTarget(payload);
		if (!target) {
			return;
		};

		if (target === "reset") {
			this.resetToButtons();
			return;
		}

		const action = this.actionByNotify.get(target);
		if (action) {
			this.triggerAction(action.id);
		}
	},

	bindUiEvents: function () {
		const root = document.getElementById(this.domId);
		if (!root || this.boundRoot === root) {
			return;
		};

		if (this.boundRoot) {
			this.boundRoot.removeEventListener("click", this.onRootClick);
		}

		root.addEventListener("click", this.onRootClick);
		this.boundRoot = root;
	},

	unbindUiEvents: function () {
		if (this.boundRoot) {
			this.boundRoot.removeEventListener("click", this.onRootClick);
			this.boundRoot = null;
		}
	},

	onRootClick: function (event) {
		const button = event.target.closest(".btn[data-action-id]");
		if (!button || !this.boundRoot || !this.boundRoot.contains(button)) {
			return;
		};

		const actionId = button.dataset.actionId;

		if (actionId === "reset") {
			this.resetToButtons();
		} else {
			this.triggerAction(actionId);
		}
	},

	triggerAction: function (actionId) {
		const action = this.actionById.get(actionId);
		if (!action) {
			return;
		};

		const isCoin = action.mode === "coin";

		this.stopAnimation();

		this.state.view = "result";
		this.state.isAnimating = true;
		this.state.mode = action.mode;

		if (isCoin) {
			this.state.symbolId = "coin-heads";
			this.state.overlayText = "";
		} else {
			this.state.symbolId = null;
			this.state.overlayText = String(randomRoll(action.sides));
		}

		this.syncView();

		// Start animation AFTER DOM is ready
		setTimeout(() => {
			const tokenWrap = document.querySelector(`#${this.domId} .tokenWrap`);

			if (isCoin) {
				this.startCoinFrames();
			} else if (tokenWrap) {
				this.startDiceFrames(action);
			}

			this.endTimeout = setTimeout(() => {
				this.finishAction(action);
			}, this.config.animationDurationMs);
		}, 50);
	},

	finishAction: function (action) {
		this.stopAnimation();

		const outcome = resolveOutcome(action);

		this.state.isAnimating = false;
		this.state.mode = outcome.mode;
		this.state.symbolId = outcome.symbolId;
		this.state.overlayText = outcome.overlayText;

		this.syncView();

		if (this.config.autoResetMs) {
			this.autoResetTimeout = setTimeout(() => {
				this.resetToButtons();
			}, this.config.autoResetMs);
		}
	},

	resetToButtons: function () {
		this.stopAnimation();
		this.state.view = "buttons";
		this.state.isAnimating = false;
		this.syncView();
	},

	getRoot: function () {
		return document.getElementById(this.domId);
	},

	syncView: function () {
		const root = this.getRoot();
		if (!root) {
			return;
		};

		const isResult = this.state.view === "result";
		root.classList.toggle("is-result", isResult);

		const resetButton = root.querySelector(".btn-reset");
		if (resetButton) {
			resetButton.disabled = !isResult;
		}

		const tokenWrap = root.querySelector(".tokenWrap");
		if (tokenWrap) {
			tokenWrap.classList.toggle("animating", this.state.isAnimating);
			tokenWrap.classList.toggle("mode-coin", this.state.mode === "coin");
			tokenWrap.classList.toggle("mode-dice", this.state.mode === "dice");
		}

		const dieValue = root.querySelector(".dieValue");
		if (dieValue) {
			dieValue.textContent = this.state.overlayText;
		}

		const coinUse = root.querySelector(".coin use");
		if (coinUse && this.state.symbolId) {
			coinUse.setAttribute("href", `${this.spriteUrl}#${this.state.symbolId}`);
			coinUse.setAttribute("xlink:href", `${this.spriteUrl}#${this.state.symbolId}`);
		}
	},

	startCoinFrames: function () {
		let heads = true;
		const useElement = this.getRoot()?.querySelector(".coin use");

		if (!useElement) return;

		this.frameInterval = setInterval(() => {
			heads = !heads;
			const symbolId = heads ? "coin-heads" : "coin-tails";
			useElement.setAttribute("href", `${this.spriteUrl}#${symbolId}`);
			useElement.setAttribute("xlink:href", `${this.spriteUrl}#${symbolId}`);
		}, this.config.animationFrameMs);
	},

	startDiceFrames: function (action) {
		const valueElement = document.querySelector(`#${this.domId} .dieValue`);
		if (!valueElement) return;

		valueElement.textContent = String(randomRoll(action.sides));

		this.frameInterval = setInterval(() => {
			valueElement.textContent = String(randomRoll(action.sides));
		}, this.config.animationFrameMs);
	},

	stopAnimation: function () {
		if (this.frameInterval) {
			clearInterval(this.frameInterval);
			this.frameInterval = null;
		}

		if (this.endTimeout) {
			clearTimeout(this.endTimeout);
			this.endTimeout = null;
		}

		if (this.autoResetTimeout) {
			clearTimeout(this.autoResetTimeout);
			this.autoResetTimeout = null;
		}
	},

	suspend: function () {
		this.stopAnimation();
		this.unbindUiEvents();
	}
});

function normalizeButtons(buttons) {
	const source = Array.isArray(buttons) && buttons.length ? buttons : DEFAULT_BUTTONS;
	const seen = new Set();

	return source.map((button, index) => {
		const normalized = normalizeButton(button, index);
		normalized.id = makeUniqueId(normalized.id, seen);
		return normalized;
	});
}

function normalizeButton(button, index) {
	const mode = button && button.mode === "coin" ? "coin" : "dice";
	const sides = toBoundedInt(button && button.sides, 2, 10000, 6);
	const notify =
		button && typeof button.notify === "string" && button.notify.trim()
			? button.notify.trim()
			: null;
	const className =
		button && typeof button.className === "string" && button.className.trim()
			? button.className.trim()
			: null;

	const normalized = {
		id:
			button && typeof button.id === "string" && button.id.trim()
				? button.id.trim()
				: `${mode}-${index}`,
		label:
			button && typeof button.label === "string" && button.label.trim()
				? button.label.trim()
				: mode === "coin"
					? "Flip Coin"
					: `Roll d${sides}`,
		mode
	};

	if (mode === "dice") {
		normalized.sides = sides;
	}

	if (notify) {
		normalized.notify = notify;
	}

	if (className) {
		normalized.className = className;
	}

	return normalized;
}

function resolveOutcome(action) {
	if (action.mode === "coin") {
		const heads = Math.random() < 0.5;
		return {
			mode: "coin",
			symbolId: heads ? "coin-heads" : "coin-tails",
			overlayText: ""
		};
	}

	const roll = randomRoll(action.sides);

	return {
		mode: "dice",
		symbolId: null,
		overlayText: String(roll)
	};
}

function parseNotificationTarget(payload) {
	if (payload === null || payload === undefined) {
		return null;
	};

	if (typeof payload === "string" || typeof payload === "number") {
		return String(payload);
	}

	if (typeof payload === "object") {
		const value = payload.name || payload.button || payload.action || payload.id;
		if (typeof value === "string" || typeof value === "number") {
			return String(value);
		}
	}

	return null;
}

function randomRoll(sides) {
	return Math.floor(Math.random() * sides) + 1;
}

function toBoundedInt(value, min, max, fallback) {
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}

function toOptionalBoundedInt(value, min, max) {
	if (value === null || value === undefined || value === false || value === "") return null;
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed <= 0) return null;
	return Math.min(max, Math.max(min, parsed));
}

function makeUniqueId(baseId, seen) {
	let id = baseId || "action";
	let suffix = 1;

	while (seen.has(id)) {
		id = `${baseId}-${suffix}`;
		suffix += 1;
	}

	seen.add(id);
	return id;
}
