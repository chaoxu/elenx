Bun.plugin({
  name: "reject-coding-agent-entrypoint",
  setup(build) {
    build.onLoad(
      { filter: /[/\\]pi-coding-agent[/\\]dist[/\\]index\.js$/ },
      () => {
        throw new Error("solver loaded the coding-agent entrypoint");
      },
    );
  },
});
