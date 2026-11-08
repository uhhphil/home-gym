import Capacitor
import CoreBluetooth
import UIKit

/// Foreground-only standard Heart Rate Service. No WHOOP cloud access, pairing
/// by name, background restoration, or automatic connection to a found device.
/// https://developer.apple.com/documentation/corebluetooth/cbcentralmanager
@objc(BluetoothHeartRatePlugin)
public class BluetoothHeartRatePlugin: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate, CBPeripheralDelegate {
    public let identifier = "BluetoothHeartRatePlugin"
    public let jsName = "BluetoothHeartRate"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
    ]
    private let serviceID = CBUUID(string: "180D")
    private let measurementID = CBUUID(string: "2A37")
    private var manager: CBCentralManager?
    private var session = ""
    private var state = "disconnected"
    private var found: [String: CBPeripheral] = [:]
    private var names: [String: String] = [:]
    private var signals: [String: Int] = [:]
    private var selected: CBPeripheral?
    private var timeout: Timer?
    private var backgroundObserver: NSObjectProtocol?

    override public func load() {
        backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
            object: nil, queue: .main) { [weak self] _ in
            guard let self = self, self.manager != nil else { return }
            self.stop()
            self.send("disconnected")
        }
    }

    deinit {
        if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) }
        timeout?.invalidate()
    }

    private func stop() {
        timeout?.invalidate(); timeout = nil
        manager?.stopScan()
        selected?.delegate = nil
        if let peripheral = selected { manager?.cancelPeripheralConnection(peripheral) }
        selected = nil
        // A new scan gets a new manager. Ignore callbacks queued by the old
        // manager, including a late success for a cancelled connection.
        manager?.delegate = nil
        manager = nil
        found.removeAll(); names.removeAll(); signals.removeAll()
    }

    private func send(_ status: String, error: String? = nil) {
        state = status
        var data: [String: Any] = ["kind": "state", "session": session, "status": status,
            "devices": found.keys.sorted().map { id -> [String: Any] in
                ["id": id, "name": names[id] ?? "Bluetooth heart-rate monitor", "rssi": signals[id] ?? 0]
            }]
        if let peripheral = selected {
            data["deviceId"] = peripheral.identifier.uuidString
            data["deviceName"] = names[peripheral.identifier.uuidString] ?? "Bluetooth heart-rate monitor"
        }
        if let error = error { data["error"] = error }
        notifyListeners("change", data: data)
    }

    private func fail(_ message: String, unavailable: Bool = false) {
        stop()
        send(unavailable ? "unavailable" : "error", error: message)
    }

    @objc func scan(_ call: CAPPluginCall) {
        guard let next = call.getString("session"), !next.isEmpty else { call.reject("Missing Bluetooth session"); return }
        DispatchQueue.main.async {
            self.stop(); self.session = next
            guard UIApplication.shared.applicationState == .active else {
                self.send("disconnected"); call.resolve(["ok": false]); return
            }
            self.send("scanning")
            // Constructing the manager (and asking permission) happens only
            // after the user's Scan button, never when the plugin is loaded.
            self.manager = CBCentralManager(delegate: self, queue: .main,
                options: [CBCentralManagerOptionShowPowerAlertKey: true])
            call.resolve(["ok": true])
        }
    }

    @objc func connect(_ call: CAPPluginCall) {
        let requestedSession = call.getString("session"), id = call.getString("id")
        DispatchQueue.main.async {
            guard requestedSession == self.session, let id = id, let peripheral = self.found[id],
                let manager = self.manager, manager.state == .poweredOn,
                ["scanning", "selecting"].contains(self.state), UIApplication.shared.applicationState == .active else {
                call.resolve(["ok": false]); return
            }
            manager.stopScan(); self.timeout?.invalidate()
            self.selected = peripheral; peripheral.delegate = self
            self.send("connecting")
            self.timeout = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
                guard let self = self, self.selected === peripheral, self.state == "connecting" else { return }
                self.fail("Connection timed out. Check heart-rate broadcast and try again.")
            }
            manager.connect(peripheral, options: nil)
            call.resolve(["ok": true])
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        let requestedSession = call.getString("session")
        DispatchQueue.main.async {
            if requestedSession == self.session { self.stop(); self.send("disconnected") }
            call.resolve(["ok": true])
        }
    }

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central === manager else { return }
        switch central.state {
        case .poweredOn:
            guard state == "scanning" else { return }
            // WHOOP may already be connected to its own app. Still show it as a
            // choice; retrieval does not connect this app to it.
            for peripheral in central.retrieveConnectedPeripherals(withServices: [serviceID]) {
                record(peripheral, name: peripheral.name, rssi: 0)
            }
            central.scanForPeripherals(withServices: [serviceID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
            timeout = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
                guard let self = self, self.manager === central, self.state == "scanning" else { return }
                central.stopScan(); self.send("selecting")
            }
        case .poweredOff: fail("Turn on Bluetooth, then scan again.")
        case .unauthorized: fail("Allow Bluetooth access for this app in iPhone Settings, then scan again.")
        case .unsupported: fail("Bluetooth heart-rate monitors are unavailable on this device.", unavailable: true)
        case .resetting: fail("Bluetooth is restarting. Try scanning again.")
        case .unknown: break
        @unknown default: fail("Bluetooth is unavailable. Try scanning again.")
        }
    }

    private func record(_ peripheral: CBPeripheral, name: String?, rssi: Int) {
        let id = peripheral.identifier.uuidString
        found[id] = peripheral
        let label = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        names[id] = label.isEmpty ? "Bluetooth heart-rate monitor" : label
        signals[id] = rssi
        send("scanning")
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard central === manager, state == "scanning" else { return }
        record(peripheral, name: advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name, rssi: RSSI.intValue)
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard central === manager, selected === peripheral, state == "connecting" else { return }
        peripheral.discoverServices([serviceID])
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard central === manager, selected === peripheral else { return }
        fail("Could not connect. Check heart-rate broadcast and try again.")
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        guard central === manager, selected === peripheral else { return }
        stop(); send("disconnected")
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard selected === peripheral, state == "connecting" else { return }
        guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == serviceID }) else {
            fail("This device did not provide the standard heart-rate service."); return
        }
        peripheral.discoverCharacteristics([measurementID], for: service)
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard selected === peripheral, state == "connecting" else { return }
        guard error == nil, let characteristic = service.characteristics?.first(where: { $0.uuid == measurementID }),
            characteristic.properties.contains(.notify) || characteristic.properties.contains(.indicate) else {
            fail("This device did not provide heart-rate notifications."); return
        }
        peripheral.setNotifyValue(true, for: characteristic)
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard selected === peripheral, characteristic.uuid == measurementID else { return }
        guard error == nil, characteristic.isNotifying else { fail("Heart-rate notifications stopped. Reconnect to try again."); return }
        timeout?.invalidate(); timeout = nil
        send("connected")
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard selected === peripheral, state == "connected", characteristic.uuid == measurementID else { return }
        guard error == nil, let value = characteristic.value else { return }
        notifyListeners("change", data: ["kind": "measurement", "session": session,
            "bytes": value.map { Int($0) }, "at": Date().timeIntervalSince1970 * 1000])
    }
}
