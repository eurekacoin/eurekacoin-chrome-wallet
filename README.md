[![Build Status](https://travis-ci.org/bodhiproject/eurekalite.svg?branch=master)](https://travis-ci.org/bodhiproject/eurekalite)

## Get EurekaLite
Chome Web Store: https://chrome.google.com/webstore/detail/eurekalite/hdmjdgjbehedbnjmljikggbmmbnbmlnd

## Web Dapp Usage

Your dapp can use EurekaLite to get information about a user's account status (whether they are logged into EurekaLite, their account address, and balance). EurekaLite also enables your dapp to listen to a window event for any changes to the user's account status.
Your dapp can also use eurekalite to make callcontract and sendtocontract calls to the blockchain. 

### Connecting EurekaLite
To use any of the above functionality, your dapp will first need to initiate a long-lived connection between EurekaLite's content script and background script.
The code to do this is already in EurekaLite, your dapp just needs to trigger the function by posting a window message.
`window.postMessage({ message: { type: 'CONNECT_EUREKALITE' }}, '*')`

This will populate the `window.eurekalite` object in your webpage. The `window.eurekalite.account` values are automatically updated when a user logs in/out or the account balance changes.

```
// window.eurekalite
{
  rpcProvider: EurekaLiteRPCProvider,
  account: {
    loggedIn: true, 
    name: "2", 
    network: "TestNet", 
    address: "qJHp6dUSmDShpEEMmwxqHPo7sFSdydSkPM", 
    balance: 49.10998413 
  }
}
```

### Refreshing your page when EurekaLite is installed or updated
You will probably want to refresh your dapp webpage when EurekaLite is installed or updated. This allows your dapp to rerun
`window.postMessage({ message: { type: 'CONNECT_EUREKALITE' }}, '*')`
which would have previously failed to do anything while EurekaLite was not yet installed. 
When EurekaLite is installed or updated it will send all existing tabs an event message. To have that event message refresh your dapp, add the following event listener.

```
function handleEurekaLiteInstalledOrUpdated(event) {
  if (event.data.message && event.data.message.type === 'EUREKALITE_INSTALLED_OR_UPDATED') {
      // Refresh the page
      window.location.reload()
  }
}  
window.addEventListener('message', handleEurekaLiteInstalledOrUpdated, false);
```

### EurekaLite User Account Status - Login/Logout
After connecting EurekaLite to your dapp, you can use an event listener to get notified of any changes to the user's account status(logging in/out, change in account balance).

```
function handleEurekaLiteAcctChanged(event) {
  if (event.data.message && event.data.message.type === "EUREKALITE_ACCOUNT_CHANGED") {
  	if (event.data.message.payload.error){
  		// handle error
  	}
    console.log("account:", event.data.message.payload.account)
  }
}
window.addEventListener('message', handleEurekaLiteAcctChanged, false);
```

Note that `window.eurekalite.account` will still get updated even if you don't set up this event listener; your Dapp just won't be notified of the changes.

### Using EurekaLiteProvider

RPC calls can be directly made via `EurekaLiteProvider` which is available to any webpage that connects to EurekaLite.

**Make sure that `window.eurekalite.rpcProvider` is defined before using it.**

```
// callcontract
const contractAddress = 'a6dd0b0399dc6162cedde85ed50c6fa4a0dd44f1';
const data = '06fdde03';
window.eurekalite.rpcProvider.rawCall(
  'callcontract',
  [contractAddress, data]
).then((res) => console.log(res));

// sendtocontract
const contractAddress = '49a941c5259e4e6ef9ac4a2a6716c1717ce0ffb6';
const data = 'd0821b0e0000000000000000000000000000000000000000000000000000000000000001';
const eurekacoinAmt = 1; // optional. defaults to 0.
const gasLimit = 200000; // optional. defaults to 200000.
const gasPrice = 40; // optional. defaults to 40 (satoshi).
window.eurekaliteProvider.rawCall(
  'sendtocontract',
  [contractAddress, data, eurekacoinAmt, gasLimit, gasPrice],
);

// Handle incoming messages
function handleMessage(message) {
  if (message.data.target == 'eurekalite-inpage') {
    // result: object
    // error: string
    const { result, error } = message.data.message.payload;
    
    if (error) {
      if (error === 'Not logged in. Please log in to EurekaLite first.') {
        // Show an alert dialog that the user needs to login first
        alert(error);
      } else {
        // Handle different error than not logged in...
      }
      return;
    }

    // Do something with the message result...
  }
}
window.addEventListener('message', handleMessage, false);
```

### Using Eweb3
You may also use our Eweb3 convenience library to make `sendtocontract` or `callcontract` calls. See the instructions in the Github repo here: https://github.com/bodhiproject/eweb3.js

### Using RegTest
You can connect EurekaLite to regtest. You will need to set the following in your eurekacoincore-node.json

```
"eurekacoin-explorer": {
  "apiPrefix": "insight-api",
  "routePrefix": "explorer",
  ...
 },
"eurekacoin-insight-api": {
  "routePrefix": "insight-api",
  ...
}  
```

## Running Dev Version
### Chrome
1. `yarn start` in the project folder to build the dev version and wait for it to be built
2. Open Chrome and load URL: `chrome://extensions`
3. Turn `Developer mode` on in the top right
4. At the top, click `Load Unpacked Extension`
5. Navigate to your `eurekalite/dist` folder
6. Click `Select`. The extension should now be loaded
7. Click on the EurekaLite logo in your Chrome extensions bar to open

## Security Flow
**First Time Flow**
1. `appSalt` is generated on a per-install basis
2. User enters `password` in Login page
3. `password` + `appSalt` runs through `scrpyt` encryption for ~3 seconds to generate `passwordHash`
4. User creates or imports wallet
5. `passwordHash` + wallet's `privateKey` runs through `scrypt` encryption for ~1 second to generate `encryptedPrivateKey`
6. Account is saved in storage with `encryptedPrivateKey`

**Return User Flow**
1. User enters password in Login page
2. `password` + `appSalt` runs through `scrpyt` encryption for ~3 seconds to generate `passwordHash`
3. Existing account is fetched from storage
4. `passwordHash` is used to decrypted the `encryptedPrivateKey`. On successful decryption of the wallet, the password is validated.
