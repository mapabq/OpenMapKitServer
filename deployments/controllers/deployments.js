const fs = require('fs');
const path = require('path');
const Q = require('q');
const Url = require('../../util//url');
const settings = require('../../settings');
const deploymentParentDir = 'deployments' ;
const deploymentParentDirPath = settings.publicDir + '/' + deploymentParentDir;

/**
 *
 * @param fd - full path to a file or directory
 * @returns Returns a deferred promise. Resolve with "stat" object for the passed in file descriptor.
 */
const statDeferred = function(fd){

    const deferred = Q.defer();

    fs.stat(fd, function(err, stats){

        if(err)
            deferred.reject(err);

        deferred.resolve(stats);
    });

    return deferred.promise;
};

/**
 *
 * @param dirPath - full path to a directory
 * @returns Returns a deferred promise. Resolved with an array of names of items in a directory.
 */
const readDirDeferred = function(dirPath){

    const deferred = Q.defer();

    fs.readdir(dirPath, function(err, contents){

        if(err)
            deferred.reject(err);

        deferred.resolve(contents);
    });

    return deferred.promise;

};

/**
 *
 * @param dirName
 * @param contents
 *
 * returns object with properties describing contents of a deployment directory
 */
const digestDeploymentDir = function(req, dirName, contents){

    // If no manifest file, message this deployment directory as invalid
    if (contents.indexOf('manifest.json') === -1) {
        return {name: dirName, valid: false, message: "Unable to find manifest file."};
    }

    // Create object that describes deployment
    var deploymentObj = {
        name: dirName,
        valid: true,
        files: {"osm": [], "mbtiles": []},
        url: Url.apiUrl(req, deploymentParentDir + '/' + dirName),
        listingUrl: Url.publicDirFileUrl(req, deploymentParentDir, dirName)
    };

    // Loop through directory items
    contents.forEach(function (item) {

        // Get item stats
        var stat = fs.statSync(deploymentParentDirPath + '/' + dirName + '/' + item);

        // We're not expecting or interested in found directories here
        if (stat.isDirectory()) return;

        // Get the file extentions
        var fileExt = path.extname(item).substring(1);

        // Check the file extension, and if its a match, add to deploy object
        if (["osm", "mbtiles"].indexOf(fileExt) > -1) {

            deploymentObj.files[fileExt].push({
                name: item,
                downloadUrl: Url.publicDirFileUrl(req, 'deployments/' + dirName, item),
                size: stat.size,
                last_modified: stat.mtime

            });
        }
    });

    return deploymentObj;
};

module.exports.find = function(req, res, next) {

    const deployments = [];
    var deploymentDirContents;
    var deploymentDirs;

    // Use sync function to read the "deployments" directory, thus avoiding nested callback at this stage
    try {
        deploymentDirContents = fs.readdirSync(deploymentParentDirPath);
    } catch (err) {
        if (err.errno === -2) {
            res.status(200).json([]);
            return;
        }
        next(err);
        return;
    }

    // Return empty array if deployments directory is empty
    const len = deploymentDirContents.length;
    if (deploymentDirContents.length === 0) {
        res.status(200).json([]);
        return;
    }

    // Get stats on contents of the deployment directory
    Q.all(deploymentDirContents.map(function (dirItem) {
            return statDeferred(deploymentParentDirPath + '/' + dirItem);
        }))
        .then(function (results) {

            // remove items that are not directories
            deploymentDirs = deploymentDirContents.filter(function (dirItem, index) {
                return results[index].isDirectory();
            });

            // Read directory contents
            return Q.all(deploymentDirs.map(function (dirName) {
                return readDirDeferred(deploymentParentDirPath + '/' + dirName)
            }))
        })
        .then(function (results) {

            // Loop thru results of each deployment directory read
            results.forEach(function (directoryContents, index) {
                deployments.push(digestDeploymentDir(req, deploymentDirs[index], directoryContents));
            })
            res.status(200).json(deploymentsSorted(deployments));
        })
        .catch(function (err) {
            next(err);
        })
        .done();
};

module.exports.findOne = function(req, res, next) {

    const deploymentDir = req.params.deployment;

    fs.stat(deploymentParentDirPath + '/' + deploymentDir, function(err){

        if(err) {
            next(err);
            return;
        }

        fs.readdir(deploymentParentDirPath + '/' + deploymentDir, function(err, contents){

            if(err) {
                next(err);
                return;
            }
            res.status(200).json(digestDeploymentDir(req, deploymentDir, contents));
        });
    });
};

function deploymentsSorted(deployments) {
    return deployments.sort(function (a, b) {
        if (a.name < b.name) return -1;
        if (a.name > b.name) return 1;
        return 0;
    });
}
