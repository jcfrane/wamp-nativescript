# Installation

1. Make sure you installed https://www.npmjs.com/package/nativescript-websockets
2. Include this file in your project. I did not bother to create a separate npm package for this coz this should be straightforward.

# Limitations

This only support JWT Token Authentication and wamp.2.json protocol and is based on wampy.js code.

# Usage

```
this.wamp = new Wamp(environment.websocketUrl, {
    realm:  'realm1',
    onChallenge: () => {
      return this.store.selectSnapshot(SessionState.user).websocketToken;
    },
    onConnect: () => {
        const channelId = this.store.selectSnapshot(SessionState.user).websocketChannelId;
        this.wamp.subscribe('bo.topic.transaction_processed' + '.' + channelId, (payload) => {
            payload = JSON.parse(payload[0]);
        });
    }
});
```


