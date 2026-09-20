/**
 * Projecture - Google Drive Sync Bridge
 *
 * Authorship: Nathan Burgdorff + Ari (ChatGPT)
 * License: GPL-3.0-or-later
 *
 * Deploy as a Web App that executes as "Me" and is accessible to "Anyone".
 * Setup() creates a high-entropy shared secret and a visible Drive backup.
 */

const ProtocolVersion = 1;
const BackupFolderName = "Projecture";
const BackupFileName = "ProjectureCloudBackup.json";
const SecretProperty = "PROJECTURE_SYNC_SECRET";
const BackupFileIdProperty = "PROJECTURE_BACKUP_FILE_ID";

function Setup() {
  const Properties = PropertiesService.getScriptProperties();
  let Secret = Properties.getProperty(SecretProperty);

  if (!Secret) {
    Secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
    Properties.setProperty(SecretProperty, Secret);
  }

  const File = GetOrCreateBackupFile_();
  console.log("Projecture Google Drive bridge is ready.");
  console.log("Sync secret: " + Secret);
  console.log("Backup file: " + File.getUrl());
  console.log("After deployment, paste the Web App /exec URL into Projecture's Drive setup dialog.");
  return Secret;
}

function doPost(Event) {
  try {
    const Request = ParseRequest_(Event);
    ValidateRequest_(Request);

    switch (Request.Action) {
      case "Read":
        return JsonResponse_(ReadEnvelope_());
      case "Write":
        return JsonResponse_(WriteEnvelope_(Request));
      default:
        throw new Error("Unknown action.");
    }
  } catch (Error) {
    return JsonResponse_({
      ProtocolVersion,
      Status: "error",
      Message: Error && Error.message ? Error.message : String(Error)
    });
  }
}

function ParseRequest_(Event) {
  const Contents = Event && Event.postData && Event.postData.contents
    ? Event.postData.contents
    : "";
  if (!Contents) throw new Error("Empty request body.");
  return JSON.parse(Contents);
}

function ValidateRequest_(Request) {
  if (!Request || typeof Request !== "object") throw new Error("Invalid request.");
  if (Number(Request.ProtocolVersion) !== ProtocolVersion) {
    throw new Error("Unsupported sync protocol version.");
  }
  const ExpectedSecret = PropertiesService.getScriptProperties().getProperty(SecretProperty);
  if (!ExpectedSecret) throw new Error("Bridge Setup() has not been run yet.");
  if (String(Request.Secret || "") !== ExpectedSecret) throw new Error("Invalid sync secret.");
}

function ReadEnvelope_() {
  const File = GetOrCreateBackupFile_();
  const Contents = File.getBlob().getDataAsString("UTF-8").trim();
  if (!Contents) return EmptyEnvelope_();

  try {
    const Parsed = JSON.parse(Contents);
    if (
      Parsed &&
      Number(Parsed.ProtocolVersion) === ProtocolVersion &&
      Object.prototype.hasOwnProperty.call(Parsed, "Revision")
    ) {
      return {
        ProtocolVersion,
        Status: "ok",
        Revision: Number(Parsed.Revision) || 0,
        UpdatedAt: Parsed.UpdatedAt || null,
        Data: Parsed.Data || null
      };
    }
  } catch (Error) {
    throw new Error("The Projecture Google Drive backup contains invalid JSON.");
  }

  throw new Error("The Projecture Google Drive backup has an unknown format.");
}

function WriteEnvelope_(Request) {
  if (
    !Request.Data ||
    Request.Data.format !== "ProjecturePortableState" ||
    Number(Request.Data.version) !== 1
  ) {
    throw new Error("Write request did not contain a supported Projecture portable-state payload.");
  }

  const Lock = LockService.getScriptLock();
  Lock.waitLock(15000);
  try {
    const Current = ReadEnvelope_();
    const ExpectedRevision = Number(Request.ExpectedRevision) || 0;
    if (ExpectedRevision !== Current.Revision) {
      return {
        ProtocolVersion,
        Status: "conflict",
        Revision: Current.Revision,
        UpdatedAt: Current.UpdatedAt || null
      };
    }

    const Next = {
      ProtocolVersion,
      Revision: Current.Revision + 1,
      UpdatedAt: new Date().toISOString(),
      Data: Request.Data
    };
    const File = GetOrCreateBackupFile_();
    File.setContent(JSON.stringify(Next, null, 2));
    return {
      ProtocolVersion,
      Status: "ok",
      Revision: Next.Revision,
      UpdatedAt: Next.UpdatedAt
    };
  } finally {
    Lock.releaseLock();
  }
}

function EmptyEnvelope_() {
  return {
    ProtocolVersion,
    Status: "ok",
    Revision: 0,
    UpdatedAt: null,
    Data: null
  };
}

function GetOrCreateBackupFile_() {
  const Properties = PropertiesService.getScriptProperties();
  const SavedFileId = Properties.getProperty(BackupFileIdProperty);
  if (SavedFileId) {
    try {
      return DriveApp.getFileById(SavedFileId);
    } catch (Error) {
      Properties.deleteProperty(BackupFileIdProperty);
    }
  }

  const Folders = DriveApp.getFoldersByName(BackupFolderName);
  const Folder = Folders.hasNext() ? Folders.next() : DriveApp.createFolder(BackupFolderName);
  const Files = Folder.getFilesByName(BackupFileName);
  const File = Files.hasNext()
    ? Files.next()
    : Folder.createFile(BackupFileName, "", MimeType.PLAIN_TEXT);
  Properties.setProperty(BackupFileIdProperty, File.getId());
  return File;
}

function JsonResponse_(Value) {
  return ContentService
    .createTextOutput(JSON.stringify(Value))
    .setMimeType(ContentService.MimeType.JSON);
}
