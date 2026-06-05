import * as diagnostics from "node:diagnostics_channel";

const diagnosticsWithTracing = diagnostics as unknown as {
  tracingChannel?: (name: string) => {
    hasSubscribers: boolean;
    subscribe: () => void;
    unsubscribe: () => void;
    traceSync: <T>(fn: () => T) => T;
    tracePromise: <T>(fn: () => Promise<T>) => Promise<T>;
    traceCallback: <T>(fn: () => T) => T;
    start: {
      publish: (_value: unknown) => void;
      runStores: (
        _store: unknown,
        callback: (...args: unknown[]) => unknown,
        _thisArg: unknown,
        ...args: unknown[]
      ) => unknown;
    };
    end: {
      publish: (_value: unknown) => void;
    };
    asyncStart: {
      publish: (_value: unknown) => void;
    };
    asyncEnd: {
      publish: (_value: unknown) => void;
    };
    error: {
      publish: (_value: unknown) => void;
    };
  };
};

if (typeof diagnosticsWithTracing.tracingChannel !== "function") {
  diagnosticsWithTracing.tracingChannel = () => ({
    hasSubscribers: false,
    subscribe() {},
    unsubscribe() {},
    traceSync(fn) {
      return fn();
    },
    tracePromise(fn) {
      return fn();
    },
    traceCallback(fn) {
      return fn();
    },
    start: {
      publish() {},
      runStores(_store, callback, _thisArg, ...args) {
        return callback(...args);
      }
    },
    end: {
      publish() {}
    },
    asyncStart: {
      publish() {}
    },
    asyncEnd: {
      publish() {}
    },
    error: {
      publish() {}
    }
  });
}
