import EurekaLiteController from '.';
import IController from './iController';
import { MESSAGE_TYPE, PORT_NAME, EUREKALITE_ACCOUNT_CHANGE } from '../../constants';
import { InpageAccount } from '../../models/InpageAccount';

export default class InpageAccountController extends IController {

  // All connected ports from content script
  private ports: chrome.runtime.Port[] = [];

  constructor(main: EurekaLiteController) {
    super('inpageAccount', main);
    chrome.runtime.onConnect.addListener(this.handleLongLivedConnection);

    this.initFinished();
  }

  // Send message to and update eurekalite.account object of all registered ports
  public sendInpageAccountAllPorts = (statusChangeReason: EUREKALITE_ACCOUNT_CHANGE) => {
    for (const port of this.ports) {
      this.sendInpageAccount(port, statusChangeReason);
    }
  }

  // bg -> content script
  public sendInpageAccount = (port: any, statusChangeReason: EUREKALITE_ACCOUNT_CHANGE) => {
    port.postMessage({
      type: MESSAGE_TYPE.SEND_INPAGE_EUREKALITE_ACCOUNT_VALUES,
      accountWrapper: this.inpageAccountWrapper(statusChangeReason),
    });
  }

  private inpageAccountWrapper = (statusChangeReason: EUREKALITE_ACCOUNT_CHANGE) => {
    const inpageAccount = new InpageAccount();
    if (this.main.account.loggedInAccount) {
      inpageAccount.loggedIn = true;
      inpageAccount.name = this.main.account.loggedInAccount!.name;
      inpageAccount.network = this.main.network.networkName;

      // loggedInAccount!.wallet is always defined if loggedInAccount is defined, but info may not be if the fetch request failed
      if (this.main.account.loggedInAccount!.wallet!.info) {
        inpageAccount.address = this.main.account.loggedInAccount!.wallet!.info!.addrStr;
        inpageAccount.balance = this.main.account.loggedInAccount!.wallet!.info!.balance;
      } else {
        return {
          account: null,
          error: Error('Unexpected error, user is logged in but wallet info is not defined') };
      }
    }
    return { account: inpageAccount, error: null, statusChangeReason };
  }

  // when a port connects
  private handleLongLivedConnection = (port: any) => {
    if (port.name !== PORT_NAME.CONTENTSCRIPT) {
      return;
    }
    this.ports.push(port);

    /*
    * Triggers when port is disconnected from other end, such as when user closes
    * the tab, or navigates to another page. Does not trigger when extension is uninstalled.
    */
    port.onDisconnect.addListener(this.handleDisconnect);
    port.onMessage.addListener((msg: any) => {
      if (msg.type === MESSAGE_TYPE.GET_INPAGE_EUREKALITE_ACCOUNT_VALUES) {
        this.sendInpageAccount(port, EUREKALITE_ACCOUNT_CHANGE.DAPP_CONNECTION);
      }
    });
  }

  // remove disconnected port from ports array
  private handleDisconnect = (port: any) => {
    const portIdx = this.ports.indexOf(port);
    if (portIdx !== -1) {
      this.ports.splice(portIdx, 1);
    }
  }
}
