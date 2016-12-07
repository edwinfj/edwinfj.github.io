$(document).ready(function() {
	// open all hyperlinks in the new tab, except links in the banner and blog
	$('#intro a, #olcourse a, .projectitem a').attr('target', '_blank');
	// asign attributes to olcourseitem children
	$('.olcourseitem > div').addClass('flexcontainer flexbottom');
	$('.olcourseitem h2').addClass('col7-l col12-s');
	$('.olcourseitem a').attr('title', 'course link');
	$('.difficulty').addClass('col2-l col12-s');
	$('.recommend').addClass('col3-l col12-s recommend');

	// set repo link images
	$('.repolink a').html('<img src="images/github.svg" alt="repository" title="repository" class="svg_icon svg_icon_github">')
	// assign attributes to demo project items
	$('.demoLink').attr('title', 'demo');
	$('.projectitem > div').addClass('flexcontainer flexbottom');
	$('.projectitem h2').addClass('col4-l col12-s');
	$('.repolink').addClass('col4-l col6-s');
	$('.projectitem .titlenote').addClass('col4-l col6-s');

    // convert difficulty level to corresponding visual effect
    var level = ['beginner', 'intermediate', 'advanced'];
    level.forEach(function(item, index) {
        $(".difficulty:contains(" + item +")").html(item + " " + "&#x25A0;".repeat(1+index) + "&#x25A1;".repeat(2 - index));
    });
    // convert recommend level to corresponding visual effect
    var recommend = [1, 2, 3, 4, 5];
    recommend.forEach(function(item) {
        $(".recommend:contains("+item+")").html("recommend " + "&#x2605;".repeat(item) + "&#x2606;".repeat(5 - item));        
    });

    // when the tag is clicked, filter in the articles that has clicked tag
    $(".tag").on("click", function() {
    	var taghtml = $(this).html();
    	switch (taghtml) {
    		case 'ALL':
    			$('article.hidearticle').removeClass('hidearticle');
    			break;
    		default:
    			// console.log(taghtml);
    			// var tagelement = $('<span class="tag">'+taghtml+'<\\span');
    			// console.log(tagelement);
    			$('article:not(.hidearticle)').addClass('hidearticle');
    			$('article')
    				.filter(function() {
    					return $(this).children('div.titlenote').children('span.tag:contains(' + taghtml +')').length > 0;
    				})
    				.removeClass('hidearticle');
    	}
    });
});