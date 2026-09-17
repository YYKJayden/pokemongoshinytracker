
(function () {
  const STORAGE_KEY = "pokemonToolsetTheme";
  const VIEW_KEY = "pokemonToolsetActiveView";

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);

    const toggleButton = document.querySelector("[data-theme-toggle-button]");
    if (toggleButton) {
      toggleButton.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      toggleButton.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    }
  }

  function initialTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  }

  function initUtilityDrawer() {
    const panel = document.querySelector(".floating-save-panel");
    if (!panel) return;

    let keyboardNavigation = false;

    document.addEventListener("keydown", function (event) {
      if (event.key === "Tab") keyboardNavigation = true;
    }, true);

    document.addEventListener("pointerdown", function () {
      keyboardNavigation = false;
      panel.classList.remove("utility-drawer-keyboard-open");
    }, true);

    panel.addEventListener("focusin", function () {
      if (keyboardNavigation) {
        panel.classList.add("utility-drawer-keyboard-open");
      }
    });

    panel.addEventListener("focusout", function () {
      window.setTimeout(function () {
        if (!panel.contains(document.activeElement)) {
          panel.classList.remove("utility-drawer-keyboard-open");
        }
      }, 0);
    });
  }

  function setView(view) {
    const tracker = document.getElementById("trackerView");
    const checker = document.getElementById("checkerView");
    const isChecker = view === "checker";

    if (!tracker || !checker) return;

    tracker.hidden = isChecker;
    checker.hidden = !isChecker;

    document.querySelectorAll("[data-view-tab]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.viewTab === (isChecker ? "checker" : "tracker"));
    });

    document.body.classList.toggle("tracker-app-shell-active", !isChecker);
    document.body.classList.toggle("checker-page-active", isChecker);
    localStorage.setItem(VIEW_KEY, isChecker ? "checker" : "tracker");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  document.addEventListener("DOMContentLoaded", function () {
    applyTheme(initialTheme());
    initUtilityDrawer();

    const toggleButton = document.querySelector("[data-theme-toggle-button]");
    if (toggleButton) {
      toggleButton.addEventListener("click", function () {
        applyTheme(currentTheme() === "dark" ? "light" : "dark");
      });
    }

    document.querySelectorAll("[data-view-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        setView(button.dataset.viewTab);
      });
    });

    const savedView = localStorage.getItem(VIEW_KEY);
    setView(savedView === "checker" ? "checker" : "tracker");
  });
})();
