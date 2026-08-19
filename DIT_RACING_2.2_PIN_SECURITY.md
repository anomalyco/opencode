# DIT RACING 2.2 — PIN Security

## User flow
- First use: Settings → សុវត្ថិភាព → កំណត់ PIN.
- On next app launch: PIN screen appears before protected content.
- Settings can change or disable the PIN after current PIN verification.
- Wrong PIN clears the field and shows an error.

## Security
The PIN is not stored as plain text; the app stores a SHA-256 digest.
For stronger protection of sensitive stored data, Android recommends using
the Android Keystore for encryption keys and cryptographic operations.

## Architecture Overview

```mermaid
graph TD
    User["👤 User"]
    App["📱 DIT Racing App"]
    
    subgraph AppLayers["Application Layers"]
        UI["UI Layer<br/>PIN Input Screen"]
        Logic["Business Logic<br/>PIN Verification"]
        Storage["Data Layer<br/>Local Storage"]
    end
    
    subgraph Security["🔒 Security Layer"]
        Hash["SHA-256<br/>Hashing"]
        Keystore["Android Keystore<br/>Encryption Keys"]
    end
    
    subgraph OnFirstLaunch["First Use Flow"]
        Settings["Settings Page"]
        Security_Menu["សុវត្ថិភាព Menu"]
        SetPIN["កំណត់ PIN Dialog"]
    end
    
    subgraph OnNextLaunch["Subsequent Launches"]
        PINCheck["PIN Verification Screen"]
        Validate["Validate against stored<br/>SHA-256 digest"]
        ProtectedContent["Access Protected Content"]
        Error["Show Error & Clear Field"]
    end
    
    User -->|Opens App| App
    App -->|First Time| OnFirstLaunch
    Settings -->|Navigate| Security_Menu
    Security_Menu -->|Select| SetPIN
    SetPIN -->|User enters PIN| Hash
    Hash -->|SHA-256 digest| Keystore
    Keystore -->|Store encrypted| Storage
    
    App -->|Subsequent Launches| OnNextLaunch
    PINCheck -->|User enters PIN| Validate
    Validate -->|Match| ProtectedContent
    Validate -->|No Match| Error
    Error -->|Retry| PINCheck
    
    Validate -->|Request encryption key| Keystore
    Storage -.->|Retrieve encrypted digest| Validate
    
    classDef security fill:#ff6b6b,stroke:#c92a2a,color:#fff
    classDef ui fill:#4c6ef5,stroke:#364fc7,color:#fff
    classDef storage fill:#ffd93d,stroke:#f59f00,color:#000
    classDef flow fill:#51cf66,stroke:#2f9e44,color:#fff
    
    class Hash,Keystore security
    class UI,PINCheck,Error ui
    class Storage storage
    class OnFirstLaunch,OnNextLaunch flow
```

## System Components

### UI Layer
- **PIN Input Screen**: Secure input field for PIN entry
- **Settings Navigation**: Access security settings
- **Error Display**: Show feedback for incorrect PIN attempts

### Business Logic
- **PIN Verification**: Compare user input against stored digest
- **First-time Setup**: Initialize PIN on first launch
- **Settings Management**: Change or disable PIN with verification

### Data Layer
- **Local Storage**: Persists encrypted PIN digest
- **Encrypted State**: Protects sensitive configuration

### Security Layer
- **SHA-256 Hashing**: One-way cryptographic hash of PIN
- **Android Keystore**: Stores and manages encryption keys securely
  - Hardware-backed when available
  - Prevents key extraction
  - OS-level protection

## Security Flow

1. **Initial PIN Setup**
   - User enters PIN in Settings → សុវត្ថិភាព → កំណត់ PIN
   - PIN is hashed using SHA-256
   - Hash is encrypted using Android Keystore
   - Encrypted digest stored in local storage

2. **PIN Verification on Launch**
   - PIN screen appears before protected content
   - User enters PIN
   - Input is hashed with SHA-256
   - Compare against stored encrypted digest
   - Match → Grant access | No match → Clear field and show error

3. **PIN Management**
   - Changing PIN requires current PIN verification first
   - Disabling PIN requires verification
   - Updates re-hash and re-encrypt using Keystore

## Best Practices Implemented

✅ PIN stored as SHA-256 digest (not plaintext)  
✅ Android Keystore for encryption key management  
✅ Error feedback without exposing sensitive details  
✅ Clear input field on failed attempts  
✅ Secure on-launch verification  
✅ Settings-based management with verification gate
