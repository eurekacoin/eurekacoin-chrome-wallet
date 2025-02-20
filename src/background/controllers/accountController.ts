import { isEmpty, find, cloneDeep } from 'lodash';
import { Wallet as EurekaCoinWallet } from 'eurekacoinjs-wallet';
import assert from 'assert';

import EurekaLiteController from '.';
import IController from './iController';
import { MESSAGE_TYPE, STORAGE, NETWORK_NAMES, EUREKALITE_ACCOUNT_CHANGE } from '../../constants';
import Account from '../../models/Account';
import Wallet from '../../models/Wallet';
import { TRANSACTION_SPEED } from '../../constants';

const INIT_VALUES = {
  mainnetAccounts: [],
  testnetAccounts: [],
  regtestAccounts: [],
  loggedInAccount: undefined,
  getInfoInterval: undefined,
};

export default class AccountController extends IController {
  private static SCRYPT_PARAMS_PRIV_KEY: any = { N: 8192, r: 8, p: 1 };
  private static GET_INFO_INTERVAL_MS: number = 30000;

  public get accounts(): Account[] {
    if (this.main.network.networkName === NETWORK_NAMES.MAINNET) {
      return this.mainnetAccounts;
    } else if (this.main.network.networkName === NETWORK_NAMES.TESTNET) {
      return this.testnetAccounts;
    }
    return this.regtestAccounts;
  }

  public get hasAccounts(): boolean {
    return !isEmpty(this.mainnetAccounts) || !isEmpty(this.testnetAccounts) || !isEmpty(this.regtestAccounts);
  }
  public loggedInAccount?: Account = INIT_VALUES.loggedInAccount;

  private mainnetAccounts: Account[] = INIT_VALUES.mainnetAccounts;
  private testnetAccounts: Account[] = INIT_VALUES.testnetAccounts;
  private regtestAccounts: Account[] = INIT_VALUES.regtestAccounts;
  private getInfoInterval?: number = INIT_VALUES.getInfoInterval;

  constructor(main: EurekaLiteController) {
    super('account', main);

    chrome.runtime.onMessage.addListener(this.handleMessage);

    const { MAINNET_ACCOUNTS, TESTNET_ACCOUNTS, REGTEST_ACCOUNTS } = STORAGE;
    chrome.storage.local.get([MAINNET_ACCOUNTS, TESTNET_ACCOUNTS, REGTEST_ACCOUNTS],
      ({ mainnetAccounts, testnetAccounts, regtestAccounts }: any) => {
      if (!isEmpty(mainnetAccounts)) {
        this.mainnetAccounts = mainnetAccounts;
      }

      if (!isEmpty(testnetAccounts)) {
        this.testnetAccounts = testnetAccounts;
      }

      if (!isEmpty(regtestAccounts)) {
        this.regtestAccounts = regtestAccounts;
      }

      this.initFinished();
    });
  }

  /*
  * Checks if the wallet name has been taken by another account.
  * @param name The wallet name to check.
  * @return If the wallet name has been already taken.
  */
  public isWalletNameTaken = (name: string): boolean => {
    return !!find(this.accounts, { name });
  }

  /*
  * Resets the account vars back to initial state.
  */
  public resetAccount = () => {
    this.loggedInAccount = INIT_VALUES.loggedInAccount;
  }

  /*
  * Initial login with the master password and routing to the correct account login page.
  */
  public login = async (password: string) => {
    this.main.crypto.generateAppSaltIfNecessary();
    this.main.crypto.derivePasswordHash(password);
  }

  public finishLogin = async () => {
    if (!this.hasAccounts) {
      // New user. No created wallets yet. No need to validate.
      this.routeToAccountPage();
      return;
    }

    const isPwValid = await this.validatePassword();
    if (isPwValid) {
      this.routeToAccountPage();
      return;
    }

    chrome.runtime.sendMessage({ type: MESSAGE_TYPE.LOGIN_FAILURE });
  }

  /*
  * Creates an account, stores it, and logs in.
  * @param accountName The account name for the new wallet account.
  * @param mnemonic The mnemonic to derive the wallet from.
  */
  public addAccountAndLogin = async (accountName: string, privateKeyHash: string, wallet: EurekaCoinWallet) => {
    this.loggedInAccount = new Account(accountName, privateKeyHash);
    this.loggedInAccount.wallet = new Wallet(wallet);

    // Prune the wallet object before storing it
    const prunedAcct = cloneDeep(this.loggedInAccount);
    prunedAcct.wallet = undefined;

    let storageKey;
    if (this.main.network.networkName === NETWORK_NAMES.MAINNET) {
      storageKey = STORAGE.MAINNET_ACCOUNTS;
    } else if (this.main.network.networkName === NETWORK_NAMES.TESTNET) {
      storageKey = STORAGE.TESTNET_ACCOUNTS;
    } else {
      storageKey = STORAGE.REGTEST_ACCOUNTS;
    }

    // Add account to storage
    this.accounts.push(prunedAcct);
    chrome.storage.local.set({
      [storageKey]: this.accounts,
    }, () => console.log(this.main.network.networkName, 'Account added', prunedAcct));

    await this.onAccountLoggedIn();
  }

  /*
  * Imports a new wallet from mnemonic.
  * @param accountName The account name for the new wallet account.
  * @param mnemonic The mnemonic to derive the wallet from.
  */
  public importMnemonic = async (accountName: string, mnemonic: string) => {
    // Non-empty mnemonic is already validated in the popup ui
    assert(mnemonic, 'invalid mnemonic');

    const network = this.main.network.network;
    const wallet = network.fromMnemonic(mnemonic);
    const privateKeyHash = this.getPrivateKeyHash(wallet);

    // Validate that we don't already have the wallet in our accountList
    const exists = await this.walletAlreadyExists(privateKeyHash);
    if (exists) {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE.IMPORT_MNEMONIC_PRKEY_FAILURE });
      return;
    }

    await this.addAccountAndLogin(accountName, privateKeyHash, wallet);
  }

  /*
  * Imports a new wallet from private key.
  * @param accountName The account name for the new wallet account.
  * @param privateKey The private key to derive the wallet from.
  */
  public importPrivateKey = async (accountName: string, privateKey: string) => {
    // Non-empty privateKey is already validated in the popup ui
    assert(privateKey, 'invalid privateKey');

    // recover wallet and privateKeyHash
    const network = this.main.network.network;
    const wallet = network.fromWIF(privateKey);
    const privateKeyHash = this.getPrivateKeyHash(wallet);

    // validate that we don't already have the wallet in our accountList accountList
    const exists = await this.walletAlreadyExists(privateKeyHash);
    if (exists) {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE.IMPORT_MNEMONIC_PRKEY_FAILURE });
      return;
    }

    await this.addAccountAndLogin(accountName, privateKeyHash, wallet);
  }

  /*
  * Saves the generated mnemonic to a file and creates a new account.
  * @param accountName The account name for the new wallet account.
  * @param mnemonic The mnemonic to derive the wallet from.
  */
  public saveToFile = (accountName: string, mnemonic: string) => {
    const timestamp = new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const file = new Blob([mnemonic], {type: 'text/plain'});
    const element = document.createElement('a');
    element.href = URL.createObjectURL(file);
    element.download = `eurekalite_${accountName}_${timestamp}.bak`;
    element.click();

    this.importMnemonic(accountName, mnemonic);
  }

  /*
  * Finds the account based on the name and logs in.
  * @param accountName {string} The account name to search by.
  */
  public loginAccount = async (accountName: string) => {
    const account = find(this.accounts, { name: accountName });
    this.loggedInAccount = cloneDeep(account);

    if (!this.loggedInAccount) {
      throw Error('Account should not be undefined');
    }

    try {
      const wallet = this.recoverFromPrivateKeyHash(this.loggedInAccount.privateKeyHash);
      this.loggedInAccount.wallet = new Wallet(wallet);

      await this.onAccountLoggedIn();
    } catch (err) {
      this.resetAccount();
      throw err;
    }
  }

  /*
  * Logs out of the current account and routes back to the account login.
  */
  public logoutAccount = () => {
    this.main.session.clearAllIntervals();
    this.main.session.clearSession();
    this.routeToAccountPage();
  }

  /*
  * Routes to the CreateWallet or AccountLogin page after unlocking with the password.
  */
  public routeToAccountPage = () => {
    if (isEmpty(this.accounts)) {
      // Accounts not found, route to Create Wallet page
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE.LOGIN_SUCCESS_NO_ACCOUNTS });
    } else {
      // Accounts found, route to Account Login page
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE.LOGIN_SUCCESS_WITH_ACCOUNTS });
    }
  }

  /*
  * Actions after adding a new account or logging into an existing account.
  */
  public onAccountLoggedIn = async (isSessionRestore = false) => {
    this.main.token.initTokenList();

    /**
     * We set sendInpageUpdate to false because we are already calling
     * inpageAccount.sendInpageAccountAllPorts() with a LOGIN message below, and we don't
     * want to call it a second time for the accountBalance update in getWalletInfo.
     */
    const sendInpageUpdate = false;
    await this.getWalletInfo(sendInpageUpdate);
    await this.startPolling();
    await this.main.token.startPolling();
    await this.main.external.startPolling();

    /**
     * If we are restoring the session, i.e. the user is already logged in and is only
     * reopening the popup, we don't need to send the SEND_INPAGE_EUREKALITE_ACCOUNT_VALUES event to
     * the inpage because window.eurekalite.account has not changed.
     */
    if (!isSessionRestore) {
      this.main.inpageAccount.sendInpageAccountAllPorts(EUREKALITE_ACCOUNT_CHANGE.LOGIN);
    }
    chrome.runtime.sendMessage({ type: MESSAGE_TYPE.ACCOUNT_LOGIN_SUCCESS });
  }

  /*
  * Stops polling for the periodic info updates.
  */
  public stopPolling = () => {
    if (this.getInfoInterval) {
      clearInterval(this.getInfoInterval);
      this.getInfoInterval = undefined;
    }
  }

  /*
  * Recovers the wallet instance from an encrypted private key.
  * @param privateKeyHash The private key hash to recover the wallet from.
  */
  private recoverFromPrivateKeyHash(privateKeyHash: string): EurekaCoinWallet {
    assert(privateKeyHash, 'invalid privateKeyHash');

    const network = this.main.network.network;
    return network.fromEncryptedPrivateKey(
      privateKeyHash,
      this.main.crypto.validPasswordHash,
      AccountController.SCRYPT_PARAMS_PRIV_KEY,
    );
  }

  private getPrivateKeyHash(wallet: EurekaCoinWallet) {
    return wallet.toEncryptedPrivateKey(
      this.main.crypto.validPasswordHash,
      AccountController.SCRYPT_PARAMS_PRIV_KEY,
    );
  }

  /*
  * Validates a password by decrypting a private key hash into a wallet instance.
  * @return Is the password valid.
  */
  private validatePassword = async (): Promise<boolean> => {
    let account: Account;
    if (!isEmpty(this.mainnetAccounts)) {
      account = this.mainnetAccounts[0];
    } else if (!isEmpty(this.testnetAccounts)) {
      account = this.testnetAccounts[0];
    } else if (!isEmpty(this.regtestAccounts)) {
      account = this.regtestAccounts[0];
    } else {
      throw Error('Trying to validate password without existing account');
    }

    try {
      this.recoverFromPrivateKeyHash(account.privateKeyHash);
      return true;
    } catch (err) {
      /*
      * If the user provides an invalid password, privateKeyHash will be invalid,
      * and recoverFromPrivateKeyHash will throw an error. In this case it is not
      * an unexpected error for us, so we don't do anything with the error.
      */
    }
    return false;
  }

  /*
  * Checks if a wallet is already in the mainnet or testnet accounts list.
  * @param privateKeyHash Unique and deterministic for each wallet.
  * @return does the wallet already exist.
  */
  private walletAlreadyExists = async (privateKeyHash: string): Promise<boolean> => {
    return !!find(this.accounts, { privateKeyHash });
  }

  /*
  * Fetches the wallet info from the current wallet instance.
  */
  private getWalletInfo = async (sendInpageUpdate = true) => {
    if (!this.loggedInAccount || !this.loggedInAccount.wallet || !this.loggedInAccount.wallet.qjsWallet) {
      console.error('Could not get wallet info.');
      return;
    }

    const infoDidUpdate = await this.loggedInAccount.wallet.updateInfo();
    if (infoDidUpdate) {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE.GET_WALLET_INFO_RETURN, info: this.loggedInAccount.wallet.info });

      if (sendInpageUpdate) {
        this.main.inpageAccount.sendInpageAccountAllPorts(EUREKALITE_ACCOUNT_CHANGE.BALANCE_CHANGE);
      }

      this.updateAndSendMaxEurekaCoinAmountToPopup();
    }
  }

  /*
  * Starts polling for periodic info updates.
  */
  private startPolling = async () => {
    if (!this.getInfoInterval) {
      this.getInfoInterval = window.setInterval(() => {
        this.getWalletInfo();
      }, AccountController.GET_INFO_INTERVAL_MS);
    }
  }

  /*
  * Executes a sendtoaddress.
  * @param receiverAddress The address to send EurekaCoin to.
  * @param amount The amount to send.
  */
  private sendTokens = async (receiverAddress: string, amount: number, transactionSpeed: TRANSACTION_SPEED) => {
    if (!this.loggedInAccount || !this.loggedInAccount.wallet || !this.loggedInAccount.wallet.qjsWallet) {
      throw Error('Cannot send with no wallet instance.');
    }

    /*
    * TODO - As of 9/21/18 there is no congestion in the network and we are under
    * capacity, so we are setting the same base fee rate for all transaction speeds.
    * In the future if traffic changes, we will set different fee rates.
    */
    try {
      const rates = {
        [TRANSACTION_SPEED.FAST]: 500,
        [TRANSACTION_SPEED.NORMAL]: 500,
        [TRANSACTION_SPEED.SLOW]: 500,
      };
      const feeRate = rates[transactionSpeed]; // satoshi/byte; 500 satoshi/byte == .005 EUREKACOIN/KB
      if (!feeRate) {
        throw Error('feeRate not set');
      }

      await this.loggedInAccount.wallet.send(receiverAddress, amount, {feeRate});
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE.SEND_TOKENS_SUCCESS });
    } catch (err) {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE.SEND_TOKENS_FAILURE, error: err });
      throw (err);
    }
  }

  /**
   * We update the maxEurekaCoin amount under 2 scnearios
   * 1 - When wallet.info has been updated because a new balance has a new maxEurekaCoinSend
   * 2 - Whenever the maxEurekaCoinSend is requested, because even if the balance does not
   * change, the available UTXOs can change(which causes a change in maxEurekaCoinSend).
   * For instance when a user sends EurekaCoin, but that transaction has not confirmed yet,
   * the balance will not change, but calcMaxEurekaCoinSend is able to account for those
   * unconfirmed UTXOs and update maxEurekaCoinSend accordingly.
   */
  private updateAndSendMaxEurekaCoinAmountToPopup = async () => {
    if (!this.loggedInAccount || !this.loggedInAccount.wallet || !this.loggedInAccount.wallet.qjsWallet) {
      throw Error('Cannot calculate max balance with no wallet instance.');
    }

    const calcMQSPr = this.loggedInAccount.wallet.calcMaxEurekaCoinSend(this.main.network.networkName);
    calcMQSPr.then(() => {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE.GET_MAX_EUREKACOIN_SEND_RETURN,
        maxEurekaCoinAmount: this.loggedInAccount!.wallet!.maxEurekaCoinSend });
    });
  }

  private handleMessage = async (
    request: any,
    _: chrome.runtime.MessageSender,
    sendResponse: (response: any) => void,
  ) => {
    try {
      switch (request.type) {
        case MESSAGE_TYPE.LOGIN:
          this.login(request.password);
          break;
        case MESSAGE_TYPE.IMPORT_MNEMONIC:
          await this.importMnemonic(request.accountName, request.mnemonicPrivateKey);
          break;
        case MESSAGE_TYPE.IMPORT_PRIVATE_KEY:
          await this.importPrivateKey(request.accountName, request.mnemonicPrivateKey);
          break;
        case MESSAGE_TYPE.SAVE_TO_FILE:
          this.saveToFile(request.accountName, request.mnemonicPrivateKey);
          break;
        case MESSAGE_TYPE.ACCOUNT_LOGIN:
          await this.loginAccount(request.selectedWalletName);
          break;
        case MESSAGE_TYPE.SEND_TOKENS:
          this.sendTokens(request.receiverAddress, request.amount, request.transactionSpeed);
          break;
        case MESSAGE_TYPE.LOGOUT:
          this.logoutAccount();
          break;
        case MESSAGE_TYPE.HAS_ACCOUNTS:
          sendResponse(this.hasAccounts);
          break;
        case MESSAGE_TYPE.GET_ACCOUNTS:
          sendResponse(this.accounts);
          break;
        case MESSAGE_TYPE.GET_LOGGED_IN_ACCOUNT:
          sendResponse(this.loggedInAccount && this.loggedInAccount.wallet && this.loggedInAccount.wallet.info
            ? { name: this.loggedInAccount.name, address: this.loggedInAccount!.wallet!.info!.addrStr }
            : undefined);
          break;
        case MESSAGE_TYPE.GET_LOGGED_IN_ACCOUNT_NAME:
          sendResponse(this.loggedInAccount ? this.loggedInAccount.name : undefined);
          break;
        case MESSAGE_TYPE.GET_WALLET_INFO:
          sendResponse(this.loggedInAccount && this.loggedInAccount.wallet
            ? this.loggedInAccount.wallet.info : undefined);
          break;
        case MESSAGE_TYPE.GET_EUREKACOIN_USD:
          sendResponse(this.loggedInAccount && this.loggedInAccount.wallet
            ? this.loggedInAccount.wallet.eurekacoinUSD : undefined);
          break;
        case MESSAGE_TYPE.VALIDATE_WALLET_NAME:
          sendResponse(this.isWalletNameTaken(request.name));
          break;
        case MESSAGE_TYPE.GET_MAX_EUREKACOIN_SEND:
          this.updateAndSendMaxEurekaCoinAmountToPopup();
          break;
        default:
          break;
      }
    } catch (err) {
      console.error(err);
      this.main.displayErrorOnPopup(err);
    }
  }
}
