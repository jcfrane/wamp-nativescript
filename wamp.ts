// Simple implementation of Wamp using nativescript websockets.
// This only support JWT Token Authentication and wamp.2.json protocol
// For more info please see: https://wamp-proto.org/_static/gen/wamp_latest.html#realms-sessions-and-transports
// This implementation is based on wampy.js please see it at: https://github.com/KSDaemon/wampy.js/
require('nativescript-websockets');

export interface WampOptions {
  realm: string;
  onChallenge: Function;
  onConnect: Function;
}

export namespace WampMessages {
  export const MESSAGE_HELLO = 1;
  export const MESSAGE_WELCOME = 2;
  export const MESSAGE_CHALLENGE = 4;
  export const MESSAGE_AUTHENTICATE = 5;
  export const MESSAGE_GOODBYE = 6;
  export const MESSAGE_SUBSCRIBE = 32;
  export const MESSAGE_SUBSCRIBED = 33;
  export const MESSAGE_EVENT = 36;
}

// Supported wamp features
export const features  = { 
  roles: {
    publisher : {
        features: {
            subscriber_blackwhite_listing: true,
            publisher_exclusion          : true,
            publisher_identification     : true
        }
    },
    subscriber: {
        features: {
            pattern_based_subscription: true,
            publication_trustlevels   : true
        }
    },
    caller    : {
        features: {
            caller_identification   : true,
            progressive_call_results: true,
            call_canceling          : true,
            call_timeout            : true
        }
    },
    callee    : {
        features: {
            caller_identification     : true,
            call_trustlevels          : true,
            pattern_based_registration: true,
            shared_registration       : true
        }
    }
  }
}

export class Wamp {
  socket: any;
  url: string;
  options: WampOptions;
  subscriptions: any[] = [];
  cache: any = {
    reqId: 0,
    sessionId: null,
    wampFeatures: null,
    isSayingGoodbye: false, // Becomes true when we programatically disconnect the connection.
    reconnectAttemps: 0,
  }
  queue: any[] = [];
  maxRetries: number = 25;

  constructor(url: string, options: WampOptions) {
    this.url = url;
    this.options = options;

    this.socket = new WebSocket(url, [ 'wamp.2.json' ]);
    
    this.initWSCallbacks();
  }

  initWSCallbacks(): void {
    this.socket.addEventListener('open', event => {
      let opts = this.merge({
        authmethods: [ 'jwt' ]
      }, features);

      // Sends a HELLO message to WAMP Server.
      // The client is always need to start sending this message to initiate a connection.
      const message = this.encode([
        WampMessages.MESSAGE_HELLO,
        this.options.realm,
        opts,
      ]);

      this.socket.send(message);     
    });

    this.socket.addEventListener('message', event => {
      const data = event.data;
      this.decode(data).then((decoded) => {
        const messageType = decoded[0];

        switch (messageType) {
          case WampMessages.MESSAGE_WELCOME:
            this.onWelcome(decoded);
            break;
          case WampMessages.MESSAGE_CHALLENGE:
            this.onChallenge();
            break;
          case WampMessages.MESSAGE_SUBSCRIBED:
            this.onSubscribed(decoded);
            break;
          case WampMessages.MESSAGE_EVENT:
            this.onEvent(decoded);
            break;
        };
      });
    });

    this.socket.addEventListener('close', event => {
      this.onClose();
    });
    
    this.socket.addEventListener('error', event => {
      console.log("The socket had an error", event.error);
    });
  }

  private onWelcome(decoded): void {
    // Sample decoded data:
    // [2, 8519136868608358, { "authid": "{\"username\":\"lfpao1221\",\"userid\":\"20831\",\"from\":\"member_site\"}", "authrole": "authenticated_user", "authroles": [ "authenticated_user" ], "roles": { "broker": { "features": { "subscriber_blackwhite_listing": true, "publisher_exclusion": true, "subscriber_metaevents": true } } }]
    if (this.cache.sessionId) {
      return;
    } else {
      this.cache.sessionId = decoded[1];
      this.cache.wampFeatures = decoded[2];
      this.cache.isSayingGoodbye = false;
      this.options.onConnect();
    }

    this.send();
  }

  private onChallenge(): Promise<any> {
    const p = new Promise((resolve) => {
      resolve(this.options.onChallenge());
    });

    p.then((token: string) => {
      this.socket.send(this.encode([WampMessages.MESSAGE_AUTHENTICATE, token, {}]));
    });

    return p;
  }

  // Triggered when a successfuly subscription happened.
  private onSubscribed(decoded): void {
    // Sample decoded data:
    // [33, 1, 543810979029915]
    const reqId = decoded[1];

    this.subscriptions[reqId].identifier = decoded[2];
  }

  private onEvent(decoded): void {
    // Sample decoded data:
    // [36, 543810979029915, 5400587907690275, {}, [{"id":"2516906","status":"Acknowledged","message":"Transaction 20190719-055521-853423-1 Deposit has been Acknowledged"}]]

    let subscription = this.subscriptions.filter((sub) => {
      return sub.identifier === decoded[1];
    });
    if (subscription.length > 0) {
      
      subscription = subscription[0];
      subscription['callback'](decoded[4]); // Execute provided callback with Websocket's payload
    }
  }

  private onClose(): void {
    // Should we reconnect?
    if (this.cache.isSayingGoodbye === false && this.cache.reconnectingAttempts <= this.maxRetries) {
      this.reconnect();
    } 
  }

  subscribe(topicUri: string, callback: Function): void {
    let reqId = this.getRequestId();
    this.cache.reqId = reqId;

    this.subscriptions[reqId] = {
      topic: topicUri,
      callback: callback,
    }

    this.send([WampMessages.MESSAGE_SUBSCRIBE, reqId, {}, topicUri]);
  }

  disconnect(): void {
    if (this.cache.sessionId) {
      this.cache.isSayingGoodbye = true;
      this.subscriptions = [];
      this.send([WampMessages.MESSAGE_GOODBYE, {}, 'wamp.close.system_shutdown']);
    } 
    
    this.socket.close();
  }

  reconnect(): void {
    this.cache.reconnectingAttempts++;
    this.socket = new WebSocket(this.url, [ 'wamp.2.json' ]);
    this.initWSCallbacks();
  }

  private send(msg?: any): void {
    if (msg) {
      this.queue.push(this.encode(msg));
    }

    if (this.cache.sessionId) {
        while (this.queue.length) {
          this.socket.send(this.queue.shift());
        }
    }
  }

  private getRequestId(): number {
    return ++this.cache.reqId;
  }

  private encode(data: any): string {
    return JSON.stringify(data);
  }

  private decode(data: any): Promise<any> {
    return new Promise(resolve => {
      resolve(JSON.parse(data));
    });
  }

  // Merge two objects into one.
  private merge (...args) {
    const obj = {}, l = args.length;
    let i, attr;

    for (i = 0; i < l; i++) {
        for (attr in args[i]) {
            obj[attr] = args[i][attr];
        }
    }

    return obj;
  }
}