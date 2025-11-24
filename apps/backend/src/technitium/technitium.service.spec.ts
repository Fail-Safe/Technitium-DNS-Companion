import { TechnitiumService } from './technitium.service';
import { TechnitiumDhcpScope } from './technitium.types';

describe('TechnitiumService buildDhcpScopeFormData', () => {
  let service: TechnitiumService;

  beforeEach(() => {
    service = new TechnitiumService([]);
  });

  afterEach(() => {
    // Clean up timers to avoid Jest "open handle" warnings
    service.onModuleDestroy();
  });

  it('serializes the required DHCP scope fields without optional values', () => {
    const scope: TechnitiumDhcpScope = {
      name: 'OfficeScope',
      startingAddress: '192.168.100.10',
      endingAddress: '192.168.100.250',
      subnetMask: '255.255.255.0',
    };

    const formData: URLSearchParams = (
      service as unknown as {
        buildDhcpScopeFormData: (scope: TechnitiumDhcpScope) => URLSearchParams;
      }
    ).buildDhcpScopeFormData(scope);

    expect(formData.get('name')).toBe('OfficeScope');
    expect(formData.get('startingAddress')).toBe('192.168.100.10');
    expect(formData.get('endingAddress')).toBe('192.168.100.250');
    expect(formData.get('subnetMask')).toBe('255.255.255.0');

    expect(formData.has('leaseTimeDays')).toBe(false);
    expect(formData.has('dnsServers')).toBe(false);
    expect(formData.has('reservedLeases')).toBe(false);
  });

  it('serializes optional collections and nullable values using the API format', () => {
    const scope: TechnitiumDhcpScope = {
      name: 'LabScope',
      startingAddress: '10.0.0.10',
      endingAddress: '10.0.0.200',
      subnetMask: '255.255.255.0',
      domainName: 'lab.local',
      domainSearchList: [],
      dnsUpdates: true,
      dnsServers: ['1.1.1.1', '1.0.0.1'],
      winsServers: [],
      ntpServers: ['10.0.0.2'],
      ntpServerDomainNames: ['time.lab.local'],
      staticRoutes: [
        {
          destination: '172.16.0.0',
          subnetMask: '255.240.0.0',
          router: '10.0.0.1',
        },
      ],
      vendorInfo: [
        {
          identifier: 'vendor',
          information: 'payload',
        },
      ],
      capwapAcIpAddresses: ['192.168.50.2'],
      tftpServerAddresses: [],
      genericOptions: [
        {
          code: 60,
          value: 'PXEClient',
        },
      ],
      exclusions: [
        {
          startingAddress: '10.0.0.50',
          endingAddress: '10.0.0.60',
        },
      ],
      reservedLeases: [
        {
          hostName: 'printer',
          hardwareAddress: 'AA-BB-CC-11-22-33',
          address: '10.0.0.80',
          comments: 'front desk',
        },
      ],
      allowOnlyReservedLeases: false,
      blockLocallyAdministeredMacAddresses: true,
      ignoreClientIdentifierOption: false,
      serverAddress: null,
      serverHostName: null,
      bootFileName: null,
      routerAddress: null,
      useThisDnsServer: false,
    };

    const formData: URLSearchParams = (
      service as unknown as {
        buildDhcpScopeFormData: (scope: TechnitiumDhcpScope) => URLSearchParams;
      }
    ).buildDhcpScopeFormData(scope);

    expect(formData.get('domainName')).toBe('lab.local');
    expect(formData.get('domainSearchList')).toBe('');
    expect(formData.get('dnsUpdates')).toBe('true');
    expect(formData.get('dnsServers')).toBe('1.1.1.1,1.0.0.1');
    expect(formData.get('winsServers')).toBe('');
    expect(formData.get('ntpServers')).toBe('10.0.0.2');
    expect(formData.get('ntpServerDomainNames')).toBe('time.lab.local');
    expect(formData.get('staticRoutes')).toBe('172.16.0.0|255.240.0.0|10.0.0.1');
    expect(formData.get('vendorInfo')).toBe('vendor|payload');
    expect(formData.get('capwapAcIpAddresses')).toBe('192.168.50.2');
    expect(formData.get('tftpServerAddresses')).toBe('');
    expect(formData.get('genericOptions')).toBe('60|PXEClient');
    expect(formData.get('exclusions')).toBe('10.0.0.50|10.0.0.60');
    expect(formData.get('reservedLeases')).toBe('printer|AA-BB-CC-11-22-33|10.0.0.80|front desk');
    expect(formData.get('allowOnlyReservedLeases')).toBe('false');
    expect(formData.get('blockLocallyAdministeredMacAddresses')).toBe('true');
    expect(formData.get('ignoreClientIdentifierOption')).toBe('false');
    expect(formData.get('serverAddress')).toBe('');
    expect(formData.get('serverHostName')).toBe('');
    expect(formData.get('bootFileName')).toBe('');
    expect(formData.get('routerAddress')).toBe('');
    expect(formData.get('useThisDnsServer')).toBe('false');
  });
});
