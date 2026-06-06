## 1. Fix Entry Point Configuration

- [x] 1.1 Change `common.main` in `io-package.json` from `build/index.js` to `build/main.js`
- [x] 1.2 Verify `package.json` `main` field is correct (should be `build/main.js`)

## 2. Add Build-Time Validation

- [x] 2.1 Create a validation script that checks compiled entry point exists
- [x] 2.2 Add postbuild step to `package.json` scripts to run validation
- [x] 2.3 Test the validation catches a missing entry point

## 3. Add CI Validation

- [x] 3.1 Add entry point validation step to GitHub Actions workflow
