export default function Icon({ name, spin, ...args }) {
    // https://fonts.google.com/icons
    const options = { 
        ...args,
        className: (args && args.className ? args.className + ' ' : '') + 
                  'material-symbols-rounded inline-flex items-center justify-center leading-none' + 
                  (spin ? ' icon-spin' : '')
    };
    
    return (<span {...options}>{name}</span>);
}
