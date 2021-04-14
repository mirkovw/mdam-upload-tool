const axios = require('axios');
const settings = require('../settings.json');
const FormData = require('form-data');
const axiosCookieJarSupport = require('axios-cookiejar-support').default;
const tough = require('tough-cookie');
const fs = require('fs-extra');
const path = require('path');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

(async () => {

    const getFileData = (url) => {
        return {
            path: url,
            data: fs.createReadStream(url),
            size: fs.statSync(url),
            name: path.basename(url),
            nameWithoutExt: path.basename(url).split('.').slice(0, -1).join('.')
        }
    }

    let baseUrl = 'https://www3.miele.de';
    let url = baseUrl + '/';
    // let url2 = 'https://www3.miele.de/videodb/dam/core/workspace?lev=0&workspace=video-assets';
    // let url3 = 'https://www3.miele.de/videodb/dam/core/asset-details?assetId=134460';

    const searchUrl = 'https://www3.miele.de/videodb/dam/core/pages/workspace/dynamic-view/workspace-view.php'; // this url is used to retrieve the asset ID based on a search query
    const versionTagUrl = 'https://www3.miele.de/videodb/dam/core/views/upload-media/single/upload-single-media-version-tag-ajax.php'; // is used to retrieve the version tag that the asset is on
    const uploadIdUrl = 'https://www3.miele.de/videodb/dam/core/views/upload-media/upload-single-media.php';
    const uploadUrl = 'https://www3.miele.de/videodb/action/uploadMedia';

    const file = getFileData(process.argv[2]); // 3rd command line arg should be the filename
    const fileImportMode = 'replace_current_version'; // can also be create_new_version
    const randomUploadId = '0_5838'; // stupid arbitrary number. No idea what it's used for but have to add it to the post data
    let dom, assetId, uploadId, versionTag;

    //setting up cookiejar support for Axios - needed to store and use cookies across requests
    axiosCookieJarSupport(axios);
    const cookieJar = new tough.CookieJar();

    const config = {
        // proxy: {
        //     host: 'localhost',
        //     port: 8888
        // },
        headers: {},
        withCredentials: true,
        maxRedirects: 0,
        jar: cookieJar
    };




    // Go to base url
    // get redirected
    try {
        console.log('GET: ' + url)
        await axios.get(url, config)
    } catch (err) {
        url = baseUrl + err.response.headers.location;
        console.log('302 = ' + url)
    }

    // follow second url
    // retrieves cookies: LastMRH_Session, MRHSession
    // get redirected
    try {
        console.log('GET: ' + url)
        await axios.get(url, config);
    } catch (err) {
        url = baseUrl + err.response.headers.location;
        console.log('302 = ' + url)
    }

    // follow third url
    // get redirected
    try {
        console.log('GET: ' + url)
        await axios.get(url, config).then(function(res) {
            console.log('200 = Success');
        });

    } catch (err) {
        console.log('Unexpected error. Quitting')
        return null;
    }


    const loginParams = new URLSearchParams();
    loginParams.append('username', settings.login);
    loginParams.append('password', settings.password);
    loginParams.append('vhost', 'standard');

    // now post data to login form with cookies
    // retrieves cookies: F5_ST
    // gets redirected
    try {
        console.log('POST: ' + url)
        await axios.post(url, loginParams, config);
    } catch (err) {
        url = baseUrl + err.response.headers.location;
        console.log('302 = ' + url)
    }


    // follow new url
    // gets cookies: ASP.NET_SessionId, f5avraaaaaaaaaaaaaaaa_session_, f5_cspm, BIGipServerpool_sap_sapstart, f5avrbbbbbbbbbbbbbbbb, f5_cspm, TS014e7f33
    // gets redirected
    try {
        console.log('GET: ' + url)
        await axios.get(url, config).then(function() {
            console.log('200 = Success')
        });
    } catch (err) {
        console.log('Unexpected error. Quitting')
        return null;
    }



    // follow searchUrl
    // gets cookies: PHPSESSID (x2)
    // retrieves assetId

    const searchParams = new URLSearchParams();
    searchParams.append('workspace', 'video-assets');
    searchParams.append('uploadedBy', 'all');
    searchParams.append('freeText', file.nameWithoutExt);
    searchParams.append('pageNum', '1');

    try {
        console.log('POST: ' + searchUrl)
        await axios.post(searchUrl, searchParams, config).then(function(res) {
            dom = new JSDOM(res.data);
            assetId = dom.window.document.querySelector('.assetSelectionCheckbox').getAttribute("data-asset-id");
            console.log('ASSET ID FOUND: ' + assetId);
        });
    }  catch (err) {
        console.log('Unexpected error. Quitting')
        return null;
    }



    // get uploadId
    try {
        console.log('GET: ' + uploadIdUrl)
        await axios.get(uploadIdUrl, config).then(function(res) {
            dom = new JSDOM(res.data);
            uploadId = dom.window.document.querySelector('#upload_single_upload_div').getAttribute("upload-id");
            console.log('UPLOAD ID FOUND: ' + uploadId)
        });
    } catch (err) {
        console.log('Unexpected error. Quitting')
        return null;
    }


    // get version tag by supplying asset ID
    try {
        console.log('GET: ' + versionTagUrl)
        await axios.get(versionTagUrl, {...config, params: {'assetId': assetId}}).then(function(res) {
            dom = new JSDOM(res.data);
            versionTag = dom.window.document.querySelector('.versionTag').getAttribute("value");
            console.log('VERSION TAG FOUND: ' + versionTag)
        });
    }  catch (err) {
        console.log('Unexpected error. Quitting')
        return null;
    }

    // finally uploading the file
    const uploadFormData = new FormData();
    uploadFormData.append('assetId', assetId);
    uploadFormData.append('uploadId', uploadId);
    uploadFormData.append('versionTag', versionTag);
    uploadFormData.append('renditionLabel', '');
    uploadFormData.append('fileImportMode', fileImportMode);
    uploadFormData.append('randomUploadId', randomUploadId);
    uploadFormData.append('files[]', file.data);

    config.headers = {
        ...config.headers,
        ...uploadFormData.getHeaders()
    }

    try {
        console.log('POST: ' + uploadUrl)
        await axios.post(uploadUrl, uploadFormData, config).then(function(res) {

            if (res.data.hasOwnProperty('operationSucceeded')) {

                if (res.data.operationSucceeded) {
                    console.log("UPLOAD OF ASSET " + res.data.assetIds[0] + ' COMPLETE');
                }

                else {
                    console.log("UPLOAD FAILED. CHECK RESPONSE DATA.")
                }

            }

            else {
                console.log("UPLOAD FAILED. CHECK RESPONSE DATA.")
            }

        });
    } catch (err) {
        console.log("UPLOAD FAILED. CHECK RESPONSE DATA.");
    }
})();