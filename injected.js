(function () {
  try {
    if (window.monaco && window.monaco.editor) {
      const models = window.monaco.editor.getModels();
      if (models.length > 0) {
        document.dispatchEvent(
          new CustomEvent("CodeSync_Data", {
            detail: {
              code: models[0].getValue(),
              lang: models[0].getLanguageId(),
            },
          }),
        );
        return;
      }
    }
    if (window.ace) {
      const editorNode = document.querySelector(".ace_editor");
      if (editorNode) {
        const editor = window.ace.edit(editorNode);
        if (editor) {
          const session = editor.getSession();
          const mode = session ? session.getMode().$id : "";
          let lang = mode ? mode.split("/").pop() : "";
          if (lang === "c_cpp") lang = "cpp";
          document.dispatchEvent(
            new CustomEvent("CodeSync_Data", {
              detail: { code: editor.getValue(), lang },
            }),
          );
          return;
        }
      }
    }
  } catch (e) {}
  document.dispatchEvent(new CustomEvent("CodeSync_Data", { detail: null }));
})();
