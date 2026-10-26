    // R40: `layout` is what 「收起宿主侧栏」 drives, and `locale` is what every
    // label goes through before render. Declaring both makes the shell re-run
    // `apply` once those services exist instead of leaving us with a null
    // handle for the rest of the session — `NW.apply` is idempotent, so the
    // re-run is safe.
    return { inject: ['slots', 'layout', 'locale'], apply: NW.apply };
  },
});
