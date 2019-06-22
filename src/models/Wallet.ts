import { action } from 'mobx';
import { Wallet as EurekaCoinWallet, Insight, WalletRPCProvider } from 'eurekacoinjs-wallet';
import deepEqual from 'deep-equal';

import { ISigner } from '../types';
import { ISendTxOptions } from 'eurekacoinjs-wallet/lib/tx';
import { RPC_METHOD, NETWORK_NAMES } from '../constants';

export default class Wallet implements ISigner {
  public qjsWallet?: EurekaCoinWallet;
  public rpcProvider?: WalletRPCProvider;
  public info?: Insight.IGetInfo;
  public eurekacoinUSD?: number;
  public maxEurekaCoinSend?: number;

  constructor(qjsWallet: EurekaCoinWallet) {
    this.qjsWallet = qjsWallet;
    this.rpcProvider = new WalletRPCProvider(this.qjsWallet);
  }

  @action
  public updateInfo = async () => {
    if (!this.qjsWallet) {
      console.error('Cannot updateInfo without qjsWallet instance.');
    }

    /**
     * We add a timeout promise to handle if qjsWallet hangs when executing getInfo.
     * (This happens if the insight api is down)
     */
    let timedOut = false;
    const timeoutPromise = new Promise((_, reject) => {
      const wait = setTimeout(() => {
        clearTimeout(wait);
        timedOut = true;
        reject(Error('wallet.getInfo failed, insight api may be down'));
      }, 30000);
    });

    const getInfoPromise = this.qjsWallet!.getInfo();
    const promises = [timeoutPromise, getInfoPromise];
    let newInfo: any;
    try {
      newInfo = await Promise.race(promises);

      // if they are not equal, then the balance has changed
      if (!timedOut && !deepEqual(this.info, newInfo)) {
        this.info = newInfo;
        return true;
      }
    } catch (e) {
      throw(Error(e));
    }

    return false;
  }

  // @param amount: (unit - whole EUREKACOIN)
  public send = async (to: string, amount: number, options: ISendTxOptions): Promise<Insight.ISendRawTxResult> => {
    if (!this.qjsWallet) {
      throw Error('Cannot send without wallet.');
    }

    // convert amount units from whole EUREKACOIN => SATOSHI EUREKACOIN
    return await this.qjsWallet!.send(to, amount * 1e8, { feeRate: options.feeRate });
  }

  public sendTransaction = async (args: any[]): Promise<any> => {
    if (!this.rpcProvider) {
      throw Error('Cannot sign transaction without RPC provider.');
    }
    if (args.length < 2) {
      throw Error('Requires first two arguments: contractAddress and data.');
    }

    try {
      return await this.rpcProvider!.rawCall(RPC_METHOD.SEND_TO_CONTRACT, args);
    } catch (err) {
      throw err;
    }
  }

  public calcMaxEurekaCoinSend = async (networkName: string) => {
    if (!this.qjsWallet || !this.info) {
      throw Error('Cannot calculate max send amount without wallet or this.info.');
    }
    this.maxEurekaCoinSend = await this.qjsWallet.sendEstimateMaxValue(this.maxEurekaCoinSendToAddress(networkName));
    return this.maxEurekaCoinSend;
  }

  /**
   * We just need to pass a valid sendTo address belonging to that network for the
   * eurekacoinjs-wallet library to calculate the maxEurekaCoinSend amount.  It does not matter what
   * the specific address is, as that does not affect the value of the
   * maxEurekaCoinSend amount
   */
  private maxEurekaCoinSendToAddress = (networkName: string) => {
    return networkName === NETWORK_NAMES.MAINNET ?
      'QN8HYBmMxVyf7MQaDvBNtneBN8np5dZwoW' : 'qLJsx41F8Uv1KFF3RbrZfdLnyWQzvPdeF9';
  }
}
