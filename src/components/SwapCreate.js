import React, { useEffect, useRef, useState } from 'react';
import { useConnect } from '@stacks/connect-react';
import { useConnectForAuth } from '../lib/auth';
import { contracts, feeContracts, NETWORK, STX_FT_SWAP_CONTRACT } from '../lib/constants';
import { TxStatus } from './TxStatus';
import {
  AnchorMode,
  callReadOnlyFunction,
  ClarityType,
  contractPrincipalCV,
  createAssetInfo,
  FungibleConditionCode,
  makeContractFungiblePostCondition,
  makeContractNonFungiblePostCondition,
  makeContractSTXPostCondition,
  makeStandardFungiblePostCondition,
  makeStandardNonFungiblePostCondition,
  makeStandardSTXPostCondition,
  noneCV,
  NonFungibleConditionCode,
  PostConditionMode,
  someCV,
  standardPrincipalCV,
  uintCV,
} from '@stacks/transactions';
import { Address } from './Address';
import { AssetIcon } from './AssetIcon';
import { getAsset, getAssetName } from './assets';
import { btcAddressToPubscriptCV } from '../lib/btcTransactions';
import { BN } from 'bn.js';
import { saveTxData } from '../lib/transactions';
import { Price } from './Price';
import { resolveBNS } from '../lib/account';
import { getFTData } from '../lib/fungibleTokens';

export function SwapCreate({
  ownerStxAddress,
  type,
  trait,
  id,
  formData: formData1,
  blockHeight,
  userSession,
}) {
  const amountSatsRef = useRef();
  const assetSellerRef = useRef();
  const nftIdRef = useRef();
  const amountRef = useRef();
  const assetBuyerRef = useRef();
  const traitRef = useRef();
  const feeContractRef = useRef();
  const [txId, setTxId] = useState();
  const [loading, setLoading] = useState();
  const [status, setStatus] = useState();
  const [formData, setFormData] = useState(formData1);
  const [ftData, setFtData] = useState();
  const { doContractCall } = useConnect();
  const { handleOpenAuth } = useConnectForAuth();

  const buyWithStx = type.startsWith('stx-');

  useEffect(() => {
    console.log({ type, formData });
    if (type === 'stx-ft' && formData && formData.trait) {
      const [contractId] = formData.trait.split('::');
      const [address, name] = contractId.split('.');
      getFTData(address, name).then(result => {
        console.log({ ftData: result });
        setFtData(result);
      });
    }
  }, [formData, type]);

  const createAction = async () => {
    setLoading(true);
    setStatus('');
    const errors = [];
    if (amountSatsRef.current.value.trim() === '') {
      errors.push('positive numbers required to swap');
    }

    if (!buyWithStx && assetSellerRef.current.value.trim() === '') {
      errors.push('BTC address is required');
    }

    const factor = buyWithStx ? 1_000_000 : 100_000_000;
    const satsOrUstxCV = uintCV(
      Math.floor(parseFloat(amountSatsRef.current.value.trim()) * factor)
    );
    if (satsOrUstxCV.value.toNumber() <= 0) {
      errors.push('positive numbers required to swap');
    }

    if (errors.length > 0) {
      setLoading(false);
      setStatus(
        errors.map((e, index) => (
          <React.Fragment key={index}>
            {e}
            <br />
          </React.Fragment>
        ))
      );
      return;
    }

    const contract = contracts[type];
    const seller = await resolveBNS(assetSellerRef.current.value.trim());
    const sellerCV = buyWithStx
      ? seller
        ? someCV(standardPrincipalCV(seller))
        : noneCV()
      : btcAddressToPubscriptCV(seller);

    let functionArgs;
    let postConditions;
    let ftContractAddress, ftTail, ftContractName, ftAssetName, ftCV;
    const assetBuyer = await resolveBNS(assetBuyerRef.current.value.trim());
    switch (type) {
      case 'nft':
        if (!assetBuyer) {
          setStatus('Buyer address must be set.');
          setLoading(false);
          return;
        }
        const nftIdCV = uintCV(nftIdRef.current.value.trim());
        const nftReceiverCV = standardPrincipalCV(assetBuyer);
        const [nftContractAddress, nftTail] = traitRef.current.value.trim().split('.');
        const [nftContractName, nftAssetName] = nftTail.split('::');
        if (!nftAssetName) {
          setStatus('"nft contract :: nft name" must be set');
          setLoading(false);
          return;
        }
        const nftCV = contractPrincipalCV(nftContractAddress, nftContractName);
        functionArgs = [satsOrUstxCV, sellerCV, nftIdCV, nftReceiverCV, nftCV];
        postConditions = [
          makeStandardNonFungiblePostCondition(
            ownerStxAddress,
            NonFungibleConditionCode.DoesNotOwn,
            createAssetInfo(nftContractAddress, nftContractName, nftAssetName),
            nftIdCV
          ),
        ];
        break;
      case 'ft':
        const ftAmountCV = uintCV(amountRef.current.value.trim());
        if (ftAmountCV.value.toNumber() <= 0) {
          setLoading(false);
          setStatus('positive numbers required to swap');
          return;
        }
        const ftReceiverCV = assetBuyer ? someCV(standardPrincipalCV(assetBuyer)) : noneCV();
        [ftContractAddress, ftTail] = traitRef.current.value.trim().split('.');
        [ftContractName, ftAssetName] = ftTail.split('::');
        if (!ftAssetName) {
          setLoading(false);
          setStatus('"ft contract :: ft name" must be set');
          return;
        }
        ftCV = contractPrincipalCV(ftContractAddress, ftContractName);
        functionArgs = [satsOrUstxCV, sellerCV, ftAmountCV, ftReceiverCV, ftCV];
        postConditions = [
          makeStandardFungiblePostCondition(
            ownerStxAddress,
            FungibleConditionCode.Equal,
            ftAmountCV.value,
            createAssetInfo(ftContractAddress, ftContractName, ftAssetName)
          ),
        ];
        break;
      case 'stx':
        const stxAmountCV = uintCV(amountRef.current.value.trim() * 1_000_000);
        if (stxAmountCV.value.toNumber() <= 0) {
          setLoading(false);
          setStatus('positive numbers required to swap');
          return;
        }
        const stxReceiverCV = assetBuyer ? someCV(standardPrincipalCV(assetBuyer)) : noneCV();
        functionArgs = [satsOrUstxCV, sellerCV, stxAmountCV, stxReceiverCV];
        postConditions = [
          makeStandardSTXPostCondition(
            ownerStxAddress,
            FungibleConditionCode.Equal,
            stxAmountCV.value
          ),
        ];
        break;
      case 'stx-ft':
        const sellFactor =
          formData.trait === 'SPN4Y5QPGQA8882ZXW90ADC2DHYXMSTN8VAR8C3X.friedger-token-v1::friedger'
            ? Math.pow(10, 6)
            : ftData
            ? Math.pow(10, ftData.decimals)
            : 1;
        const ftAmount2CV = uintCV(amountRef.current.value.trim() * sellFactor);
        if (ftAmount2CV.value.toNumber() <= 0) {
          setLoading(false);
          setStatus('positive numbers required to swap');
          return;
        }
        [ftContractAddress, ftTail] = traitRef.current.value.trim().split('.');
        [ftContractName, ftAssetName] = ftTail.split('::');
        if (!ftAssetName) {
          setLoading(false);
          setStatus('"ft contract :: ft name" must be set');
          return;
        }
        ftCV = contractPrincipalCV(ftContractAddress, ftContractName);
        const feeId = feeContractRef.current.value;
        const feeContract = feeContracts[feeId];
        const feesCV = contractPrincipalCV(feeContract.address, feeContract.name);
        const fees = await callReadOnlyFunction({
          contractAddress: feeContract.address,
          contractName: feeContract.name,
          functionName: 'get-fees',
          functionArgs: [satsOrUstxCV],
          senderAddress: feeContract.address,
        });
        functionArgs = [satsOrUstxCV, ftAmount2CV, sellerCV, ftCV, feesCV];
        postConditions =
          feeId === 'stx'
            ? [
                makeStandardSTXPostCondition(
                  ownerStxAddress,
                  FungibleConditionCode.Equal,
                  satsOrUstxCV.value.add(fees.value.value)
                ),
              ]
            : feeId === 'mia'
            ? [
                makeStandardSTXPostCondition(
                  ownerStxAddress,
                  FungibleConditionCode.Equal,
                  satsOrUstxCV.value
                ),
              ]
            : [
                makeStandardSTXPostCondition(
                  ownerStxAddress,
                  FungibleConditionCode.Equal,
                  satsOrUstxCV.value
                ),
                makeStandardFungiblePostCondition(
                  ownerStxAddress,
                  FungibleConditionCode.Equal,
                  fees.value.value,
                  createAssetInfo(
                    feeContract.ft.address,
                    feeContract.ft.name,
                    feeContract.ft.assetName
                  )
                ),
              ];
        break;
      default:
        break;
    }
    await doContractCall({
      contractAddress: contract.address,
      contractName: contract.name,
      functionName: 'create-swap',
      functionArgs,
      network: NETWORK,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Deny,
      postConditions,

      onCancel: () => {
        setLoading(false);
      },
      onFinish: result => {
        setStatus('Saving transaction to your storage');
        setTxId(result.txId);
        saveTxData(result, userSession)
          .then(r => {
            setLoading(false);
            setStatus(undefined);
          })
          .catch(e => {
            console.log(e);
            setLoading(false);
            setStatus("Couldn't save the transaction");
          });
      },
    });
  };

  const setRecipientAction = async () => {
    setLoading(true);
    const errors = [];
    if (assetBuyerRef.current.value.trim() === '') {
      errors.push('Receiver is required');
    }
    if (errors.length > 0) {
      setLoading(false);
      setStatus(
        errors.map((e, index) => (
          <React.Fragment key={index}>
            {e}
            <br />
          </React.Fragment>
        ))
      );
      return;
    }
    const contract = contracts[type];
    let functionArgs;
    let postConditions;
    let functionName;
    let idCV;
    switch (type) {
      case 'nft':
        setStatus('not supported');
        return;
      case 'ft':
        functionName = 'set-ft-receiver';
        idCV = uintCV(id);
        functionArgs = [idCV];
        postConditions = [];
        break;
      case 'stx':
        functionName = 'set-stx-receiver';
        idCV = uintCV(id);
        functionArgs = [idCV];
        postConditions = [];
        break;

      default:
        break;
    }
    await doContractCall({
      contractAddress: contract.address,
      contractName: contract.name,
      functionName,
      functionArgs,
      network: NETWORK,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Deny,
      postConditions,

      onCancel: () => {
        setLoading(false);
      },
      onFinish: result => {
        setLoading(false);
        setTxId(result.txId);
      },
    });
  };

  const cancelAction = async () => {
    setLoading(true);
    const contract = contracts[type];
    let functionArgs;
    let postConditions;
    let idCV;
    let ftContractAddress, ftTail, ftContractName, ftAssetName, amountInSmallestUnit;
    switch (type) {
      case 'nft':
        const [nftContractAddress, nftTail] = traitRef.current.value.trim().split('.');
        const [nftContractName, nftAssetName] = nftTail.split('::');

        idCV = uintCV(id);
        functionArgs = [idCV];
        postConditions = [
          makeContractNonFungiblePostCondition(
            contract.address,
            contract.name,
            NonFungibleConditionCode.DoesNotOwn,
            createAssetInfo(nftContractAddress, nftContractName, nftAssetName),
            idCV
          ),
        ];

        break;
      case 'ft':
        [ftContractAddress, ftTail] = traitRef.current.value.trim().split('.');
        [ftContractName, ftAssetName] = ftTail.split('::');
        amountInSmallestUnit = formData.amount * Math.pow(10, sellDecimals);
        idCV = uintCV(id);
        functionArgs = [idCV];
        postConditions = [
          makeContractFungiblePostCondition(
            contract.address,
            contract.name,
            FungibleConditionCode.Equal,
            new BN(amountInSmallestUnit),
            createAssetInfo(ftContractAddress, ftContractName, ftAssetName)
          ),
        ];
        break;
      case 'stx':
        amountInSmallestUnit = formData.amount * Math.pow(10, sellDecimals);

        idCV = uintCV(id);
        functionArgs = [idCV];
        postConditions = [
          makeContractSTXPostCondition(
            contract.address,
            contract.name,
            FungibleConditionCode.Equal,
            new BN(amountInSmallestUnit)
          ),
        ];
        break;
      case 'stx-ft':
        idCV = uintCV(id);
        const factor = buyWithStx ? 1_000_000 : 100_000_000;
        const satsOrUstxCV = uintCV(
          Math.floor(parseFloat(amountSatsRef.current.value.trim()) * factor)
        );

        [ftContractAddress, ftTail] = traitRef.current.value.trim().split('.');
        [ftContractName, ftAssetName] = ftTail.split('::');
        if (!ftAssetName) {
          setLoading(false);
          setStatus('"ft contract :: ft name" must be set');
          return;
        }
        const ftCV = contractPrincipalCV(ftContractAddress, ftContractName);
        const feeId = feeContractRef.current.value;
        const feeContract = feeContracts[feeId];
        const feesCV = contractPrincipalCV(feeContract.address, feeContract.name);
        const fees = await callReadOnlyFunction({
          contractAddress: feeContract.address,
          contractName: feeContract.name,
          functionName: 'get-fees',
          functionArgs: [satsOrUstxCV],
          senderAddress: feeContract.address,
        });
        functionArgs = [idCV, ftCV, feesCV];
        postConditions =
          feeId === 'stx'
            ? [
                makeContractSTXPostCondition(
                  contract.address,
                  contract.name,
                  FungibleConditionCode.Equal,
                  satsOrUstxCV.value
                ),
                makeContractSTXPostCondition(
                  feeContract.address,
                  feeContract.name,
                  FungibleConditionCode.Equal,
                  fees.value.value
                ),
              ]
            : feeId === 'mia'
            ? [
                makeContractSTXPostCondition(
                  contract.address,
                  contract.name,
                  FungibleConditionCode.Equal,
                  satsOrUstxCV.value
                ),
              ]
            : [
                makeContractSTXPostCondition(
                  contract.address,
                  contract.name,
                  FungibleConditionCode.Equal,
                  satsOrUstxCV.value
                ),
                makeContractFungiblePostCondition(
                  contract.address,
                  contract.name,
                  FungibleConditionCode.Equal,
                  fees.value.value,
                  createAssetInfo(
                    feeContract.ft.address,
                    feeContract.ft.name,
                    feeContract.ft.assetName
                  )
                ),
              ];
        break;

      default:
        setLoading(false);
        return;
    }
    await doContractCall({
      contractAddress: contract.address,
      contractName: contract.name,
      functionName: 'cancel',
      functionArgs,
      network: NETWORK,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Deny,
      postConditions,

      onCancel: () => {
        setLoading(false);
      },
      onFinish: result => {
        setLoading(false);
        setTxId(result.txId);
        saveTxData(result, userSession)
          .then(r => {
            setLoading(false);
          })
          .catch(e => {
            console.log(e);
            setLoading(false);
          });
      },
    });
  };

  const submitAction = async () => {
    setLoading(true);

    const factor = buyWithStx ? 1_000_000 : 100_000_000;
    const satsOrUstxCV = uintCV(
      Math.floor(parseFloat(amountSatsRef.current.value.trim()) * factor)
    );

    const swapIdCV = uintCV(id);
    const contract = contracts[type];

    let functionArgs;
    let postConditions;
    switch (type) {
      case 'stx-ft':
        const [ftContractAddress, ftTail] = traitRef.current.value.trim().split('.');
        const [ftContractName, ftAssetName] = ftTail.split('::');
        const ftCV = contractPrincipalCV(ftContractAddress, ftContractName);
        const amountInSmallestUnit = formData.amount * Math.pow(10, sellDecimals);
        const feeId = feeContractRef.current.value;
        const feeContract = feeContracts[feeId];
        const feesCV = contractPrincipalCV(feeContract.address, feeContract.name);
        const feesResponse = await callReadOnlyFunction({
          contractAddress: feeContract.address,
          contractName: feeContract.name,
          functionName: 'get-fees',
          functionArgs: [satsOrUstxCV],
          senderAddress: feeContract.address,
        });
        const fees =
          feesResponse.type === ClarityType.OptionalNone ? undefined : feesResponse.value.value;
        if (!fees) {
          setLoading(false);
          setStatus("Couldn't load fees.");
          return;
        }
        functionArgs = [swapIdCV, ftCV, feesCV];
        postConditions = [
          makeContractSTXPostCondition(
            STX_FT_SWAP_CONTRACT.address,
            STX_FT_SWAP_CONTRACT.name,
            FungibleConditionCode.Equal,
            satsOrUstxCV.value
          ),
          makeStandardFungiblePostCondition(
            ownerStxAddress,
            FungibleConditionCode.Equal,
            new BN(amountInSmallestUnit),
            createAssetInfo(ftContractAddress, ftContractName, ftAssetName)
          ),
        ];
        if (feeId === 'stx') {
          postConditions.push(
            makeContractSTXPostCondition(
              feeContract.address,
              feeContract.name,
              FungibleConditionCode.Equal,
              fees
            )
          );
        } else if (feeId === 'mia') {
        } else {
          postConditions.push(
            makeContractFungiblePostCondition(
              feeContract.address,
              feeContract.name,
              FungibleConditionCode.Equal,
              fees,
              createAssetInfo(feeContract.ft.address, feeContract.ft.name, feeContract.ft.assetName)
            )
          );
        }
        break;

      default:
        setLoading(false);
        return;
    }
    try {
      // submit
      await doContractCall({
        contractAddress: contract.address,
        contractName: contract.name,
        functionName: 'submit-swap',
        functionArgs,
        postConditionMode: PostConditionMode.Deny,
        postConditions,
        userSession,
        network: NETWORK,
        anchorMode: AnchorMode.Any,
        onCancel: () => {
          setLoading(false);
        },
        onFinish: result => {
          setLoading(false);
          setTxId(result.txId);
          saveTxData(result, userSession)
            .then(r => {
              setLoading(false);
            })
            .catch(e => {
              console.log(e);
              setLoading(false);
            });
        },
      });
    } catch (e) {
      console.log(e);
      setLoading(false);
    }
  };

  // sell (left to right)
  const sellType = buyWithStx ? type.split('-')[1] : type;
  const sellDecimals =
    sellType === 'stx'
      ? 6
      : type === 'stx-ft' &&
        formData.trait === 'SPN4Y5QPGQA8882ZXW90ADC2DHYXMSTN8VAR8C3X.friedger-token-v1::friedger'
      ? 6
      : type === 'stx-ft' && ftData
      ? ftData.decimals
      : 0;
  const asset = getAsset(sellType, formData.trait);
  const assetName = getAssetName(sellType, formData.trait);
  // buy (right to left)
  const buyWithAsset = buyWithStx ? 'STX' : 'BTC';
  const buyDecimals = buyWithStx ? 6 : 8;

  const createSellOrder = false;
  return (
    <>
      <h3>
        {id ? null : 'Create'} Swap {buyWithAsset}-{asset} {id ? `#${id}` : null}{' '}
        {formData.doneFromSwap === 1 ? <>(completed)</> : null}
      </h3>
      {type === 'nft' && (
        <p>For a swap of Bitcoins and an NFT on Stacks, the NFT has to comply with SIP-9.</p>
      )}
      {type === 'ft' && (
        <p>For a swap of Bitcoins and a token on Stacks, the token has to comply with SIP-10.</p>
      )}
      {type === 'stx-ft' && (
        <p>For a swap of Stacks and a token on Stacks, the token has to comply with SIP-10.</p>
      )}
      {buyWithStx ? (
        <p>
          Your Stacks tokens will be sent to the contract now (including 1% fees) and will be
          released to the buyer if the {assetName} {sellType === 'nft' ? ' is ' : ' are '}{' '}
          transferred to you. If the swap expired after 100 Stacks blocks and you called "cancel"
          your Stacks tokens including fees are returned to you.
        </p>
      ) : (
        <p>
          Your {assetName} {type === 'nft' ? ' is ' : ' are '} sent to the contract now and will be
          released to the buyer if the BTC transaction is verified (or back to you if the swap
          expired after 100 Stacks blocks and you called "cancel").
        </p>
      )}
      <form>
        <div className={`input-group ${type === 'stx' ? 'd-none' : ''}`}>
          <input
            type="text"
            className="form-control"
            ref={traitRef}
            value={formData.trait}
            onChange={e => setFormData({ ...formData, trait: e.current.value })}
            aria-label={`fully qualified contract of the ${assetName} and its asset class`}
            placeholder={`fully qualified contract of the ${assetName} and its asset class`}
            readOnly={trait}
            required
            minLength="1"
          />
        </div>
        <div className="container">
          <div className="row align-items-center m-5">
            <div className="col text-center">
              {(!id || formData.assetSenderFromSwap === ownerStxAddress) && !buyWithStx ? (
                <>
                  Seller (You)
                  <br />
                  <Address addr={ownerStxAddress} />
                </>
              ) : (
                <>
                  <br />
                  Seller
                  {formData.assetSenderFromSwap === ownerStxAddress ||
                  (!buyWithStx && !id) ||
                  (buyWithStx &&
                    id &&
                    ((formData.doneFromSwap === 0 && formData.assetSenderFromSwap === 'none') ||
                      formData.assetSenderFromSwap === `(some ${ownerStxAddress})`))
                    ? ' (You)'
                    : null}
                </>
              )}
              <br />
              <div className="input-group">
                <input
                  type="text"
                  className="form-control"
                  ref={assetSellerRef}
                  defaultValue={
                    (formData.btcRecipient
                      ? formData.btcRecipient
                      : formData.assetSenderFromSwap !== 'none'
                      ? formData.assetSenderFromSwap.substr(
                          6,
                          formData.assetSenderFromSwap.length - 7
                        )
                      : undefined) ||
                    (buyWithStx && id && formData.doneFromSwap === 0 ? ownerStxAddress : '')
                  }
                  onChange={e => setFormData({ ...formData, btcRecipient: e.target.value })}
                  aria-label={
                    buyWithStx
                      ? 'Stacks address or name (optional)'
                      : 'Bitcoin recipient address (must start with 1)'
                  }
                  placeholder={
                    buyWithStx
                      ? 'Stacks address or name (optional)'
                      : 'Bitcoin recipient address (must start with 1)'
                  }
                  readOnly={id}
                  required
                  max="40"
                  minLength="1"
                />
              </div>
            </div>
            <div className="col text-center border-left">
              <AssetIcon type={sellType} trait={formData.trait} />
              <br />
              <div className={`input-group ${type === 'nft' ? '' : 'd-none'}`}>
                <input
                  type="number"
                  className="form-control"
                  ref={nftIdRef}
                  value={formData.nftId}
                  onChange={e => setFormData({ ...formData, nftId: e.target.value })}
                  aria-label="ID of NFT"
                  placeholder="ID of NFT"
                  readOnly={id}
                  required
                  minLength="1"
                />
              </div>
              <div className={`input-group ${type === 'nft' ? 'd-none' : ''}`}>
                <input
                  type="number"
                  className="form-control"
                  ref={amountRef}
                  value={formData.amount}
                  onChange={e => setFormData({ ...formData, amount: e.target.value })}
                  aria-label={`amount of ${assetName}${type === 'stx' ? '' : ' in smallest unit'}`}
                  placeholder={`amount of ${assetName}${type === 'stx' ? '' : ' in smallest unit'}`}
                  readOnly={id}
                  required
                  minLength="1"
                />
              </div>
              <i className="bi bi-arrow-right"></i>
              <br />
              {type !== 'nft' && (
                <>
                  <br />
                  <Price
                    sell={{ amount: formData.amount, asset: asset, decimals: sellDecimals }}
                    buy={{
                      amount: formData.amountSats,
                      asset: buyWithAsset,
                      decimals: buyDecimals,
                    }}
                    editablePrice={createSellOrder}
                  />
                  <br />
                  <br />
                </>
              )}
              <i className="bi bi-arrow-left"></i>
              <br />
              <div className="input-group">
                <input
                  type="number"
                  className="form-control"
                  ref={amountSatsRef}
                  value={formData.amountSats}
                  onChange={e => setFormData({ ...formData, amountSats: e.target.value })}
                  aria-label={
                    buyWithStx
                      ? type === 'nft'
                        ? `Price for NFT in STXs`
                        : `amount of STXs`
                      : type === 'nft'
                      ? `Price for NFT in Bitcoin`
                      : `amount of Bitcoins`
                  }
                  placeholder={
                    buyWithStx
                      ? type === 'nft'
                        ? `Price for NFT in STXs`
                        : `amount of STXs`
                      : type === 'nft'
                      ? `Price for NFT in Bitcoin`
                      : `amount of Bitcoins`
                  }
                  readOnly={id}
                  required
                  minLength="1"
                />
              </div>
              <AssetIcon type={buyWithStx ? 'stx' : 'btc'} />
            </div>
            <div className="col text-center">
              {(!id || formData.assetSenderFromSwap === ownerStxAddress) && buyWithStx ? (
                <>
                  Buyer (You)
                  <br />
                  <Address addr={ownerStxAddress} />
                </>
              ) : (
                <>
                  <br />
                  Buyer
                </>
              )}

              <br />
              <div className="input-group">
                <input
                  type="text"
                  className="form-control"
                  ref={assetBuyerRef}
                  value={formData.assetRecipient}
                  onChange={e => setFormData({ ...formData, assetRecipient: e.target.value })}
                  aria-label={`${assetName} receiver's Stacks address`}
                  placeholder={`${assetName} receiver's Stacks address`}
                  readOnly={(id && formData.assetRecipientFromSwap) || buyWithStx}
                  required
                  minLength="1"
                />
              </div>
            </div>
          </div>
          {status && (
            <div className="row align-items-center">
              <div className="col text-center alert">{status}</div>
            </div>
          )}
          {buyWithStx && (
            <div className="row m-2">
              <div className="col" />
              <div className="col text-center">
                <select
                  className="form-select form-select-sm"
                  ref={feeContractRef}
                  value={formData.feeId || 'stx'}
                  onChange={e => setFormData({ ...formData, feeId: e.target.value })}
                  disabled={id}
                  aria-label="select fee model"
                >
                  <option value="stx">1% fee in STX</option>
                  <option value="fpwr">1% fee in FPWR</option>
                  <option value="frie">1% fee in FRIE</option>
                  <option value="mia">0% fee (MIA holders only)</option>
                </select>
              </div>
              <div className="col" />
            </div>
          )}
          <div className="row m-2">
            <div className="col-12 text-center">
              {!ownerStxAddress ? (
                <>
                  <button
                    className="btn btn-lg btn-outline-primary mt-4"
                    type="button"
                    onClick={handleOpenAuth}
                  >
                    Get Started
                  </button>
                </>
              ) : (
                <>
                  {id &&
                    (formData.assetSenderFromSwap === ownerStxAddress ||
                      (buyWithStx && formData.assetRecipientFromSwap === ownerStxAddress)) &&
                    formData.whenFromSwap + 100 < blockHeight &&
                    formData.doneFromSwap === 0 && (
                      <button
                        className="btn btn-block btn-primary"
                        type="button"
                        onClick={cancelAction}
                      >
                        <div
                          role="status"
                          className={`${
                            loading ? '' : 'd-none'
                          } spinner-border spinner-border-sm text-info align-text-top mr-2`}
                        />
                        Cancel swap
                      </button>
                    )}
                  {id ? (
                    // show existing swap
                    buyWithStx ? (
                      formData.doneFromSwap === 1 ? (
                        <>
                          <button className="btn btn-block btn-success" type="button" disabled>
                            Completed
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-block btn-primary"
                          type="button"
                          onClick={submitAction}
                        >
                          <div
                            role="status"
                            className={`${
                              loading ? '' : 'd-none'
                            } spinner-border spinner-border-sm text-info align-text-top mr-2`}
                          />
                          Sell {asset}
                        </button>
                      ) // handle buy with btc
                    ) : formData.assetRecipientFromSwap ? (
                      <></>
                    ) : (
                      <button
                        className="btn btn-block btn-primary"
                        type="button"
                        onClick={setRecipientAction}
                      >
                        <div
                          role="status"
                          className={`${
                            loading ? '' : 'd-none'
                          } spinner-border spinner-border-sm text-info align-text-top mr-2`}
                        />
                        Buy {asset}
                      </button>
                    )
                  ) : (
                    // create new swap
                    <button
                      className="btn btn-block btn-primary"
                      type="button"
                      onClick={createAction}
                    >
                      <div
                        role="status"
                        className={`${
                          loading ? '' : 'd-none'
                        } spinner-border spinner-border-sm text-info align-text-top mr-2`}
                      />
                      {buyWithStx ? 'Buy' : 'Sell'} {asset}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </form>
      {txId && <TxStatus txId={txId} />}
    </>
  );
}
